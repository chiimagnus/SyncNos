import { migrationProfileReferencePatchDigest } from '@platform/local-data/migration-journal';
import { storageGet, storageSet } from '@platform/storage/local';
import {
  MIGRATION_PROFILE_PROVIDERS,
  MIGRATION_PROFILE_REFERENCE_PATCH_VERSION,
  MAX_MIGRATION_PROFILE_QUEUE_ITEMS,
  LocalDataContractError,
  parseMigrationProfileReferencePatch,
  type MigrationProfileProvider,
  type MigrationProfileQueueEntry,
  type MigrationProfileReferencePatch,
  type MigrationReferenceFreeSyncJob,
  type StableConversationReference,
} from './contracts';
import type { DigestProvider } from './digest';
import {
  AUTO_SYNC_QUEUE_MAX_ITEMS,
  AUTO_SYNC_QUEUE_STORAGE_KEYS,
  AUTO_SYNC_STABLE_QUEUE_VERSION,
} from '@services/sync/auto-sync/auto-sync-keys';
import { SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-store';

export type ProfileReferenceStorage = Readonly<{
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}>;

export type LegacyConversationReferenceResolution = Readonly<{
  conversationId: number;
  reference: StableConversationReference | null;
}>;

export type ProfileReferenceRebaseDependencies = Readonly<{
  digestProvider: DigestProvider;
  now?: () => number;
  resolveLegacyConversationReferences: (
    conversationIds: readonly number[],
  ) => Promise<readonly LegacyConversationReferenceResolution[]>;
  storage?: ProfileReferenceStorage;
  validateNativeReference: (reference: StableConversationReference) => Promise<boolean>;
}>;

export type ProfileReferenceRebase = Readonly<{
  applyAndVerify: (patch: MigrationProfileReferencePatch, expectedDigest: string) => Promise<void>;
  buildPatch: () => Promise<MigrationProfileReferencePatch>;
  verifyApplied: (patch: MigrationProfileReferencePatch, expectedDigest: string) => Promise<void>;
}>;

export const MIGRATION_PROFILE_SIDECAR_STORAGE_KEYS = Object.freeze([
  ...MIGRATION_PROFILE_PROVIDERS.map((provider) => AUTO_SYNC_QUEUE_STORAGE_KEYS[provider]),
  ...MIGRATION_PROFILE_PROVIDERS.map((provider) => SYNC_JOB_STORAGE_KEYS[provider]),
]);

type LegacyQueueEntry = Readonly<{ conversationId: number; dueAt: number }>;
type ParsedQueue =
  | Readonly<{ kind: 'stable'; entries: readonly MigrationProfileQueueEntry[] }>
  | Readonly<{ kind: 'legacy'; entries: readonly LegacyQueueEntry[] }>;

function invalid(): never {
  throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
}

function withDiagnosticField<T>(field: string, callback: () => T): T {
  try {
    return callback();
  } catch (error) {
    if (error instanceof LocalDataContractError && error.code === 'MIGRATION_VALIDATION_FAILED') {
      throw new LocalDataContractError(error.code, { ...(error.diagnostics ?? {}), field });
    }
    throw error;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) invalid();
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

function positiveInteger(value: unknown): number {
  const parsed = nonNegativeInteger(value);
  if (parsed <= 0) invalid();
  return parsed;
}

function text(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const normalized = value.trim();
  if (!normalized) invalid();
  return normalized;
}

function identityKey(reference: StableConversationReference): string {
  return `${reference.source}\u0000${reference.conversationKey}`;
}

function parseStableQueueEntry(value: unknown): MigrationProfileQueueEntry {
  const input = record(value);
  exactKeys(input, ['source', 'conversationKey', 'dueAt']);
  return Object.freeze({
    source: text(input.source),
    conversationKey: text(input.conversationKey),
    dueAt: positiveInteger(input.dueAt),
  });
}

function dedupeStableQueue(entries: readonly MigrationProfileQueueEntry[]): readonly MigrationProfileQueueEntry[] {
  const byIdentity = new Map<string, MigrationProfileQueueEntry>();
  for (const entry of entries) {
    const key = identityKey(entry);
    const previous = byIdentity.get(key);
    if (!previous || previous.dueAt < entry.dueAt) byIdentity.set(key, entry);
  }
  return Object.freeze([...byIdentity.values()]);
}

function parseStoredQueue(provider: MigrationProfileProvider, value: unknown): ParsedQueue {
  if (value == null) return Object.freeze({ kind: 'legacy', entries: Object.freeze([]) });
  const input = record(value);
  if (input.version === AUTO_SYNC_STABLE_QUEUE_VERSION) {
    exactKeys(input, ['version', 'entries']);
    if (!Array.isArray(input.entries) || input.entries.length > AUTO_SYNC_QUEUE_MAX_ITEMS[provider]) invalid();
    return Object.freeze({
      kind: 'stable',
      entries: dedupeStableQueue(input.entries.map(parseStableQueueEntry)),
    });
  }

  const rows = Object.entries(input);
  if (rows.length > AUTO_SYNC_QUEUE_MAX_ITEMS[provider]) invalid();
  const entries = rows.map(([rawConversationId, rawDueAt]) => {
    if (!/^[1-9][0-9]*$/.test(rawConversationId)) invalid();
    const conversationId = Number(rawConversationId);
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) invalid();
    return Object.freeze({ conversationId, dueAt: positiveInteger(rawDueAt) });
  });
  return Object.freeze({ kind: 'legacy', entries: Object.freeze(entries) });
}

function legacyFinishedCounts(input: Record<string, unknown>): Readonly<{ okCount: number; failCount: number }> {
  const hasCurrentCounts =
    Number.isSafeInteger(input.okCount) &&
    Number(input.okCount) >= 0 &&
    Number.isSafeInteger(input.failCount) &&
    Number(input.failCount) >= 0;
  if (hasCurrentCounts) {
    return Object.freeze({ okCount: Number(input.okCount), failCount: Number(input.failCount) });
  }
  if (!Array.isArray(input.perConversation)) invalid();
  let okCount = 0;
  let failCount = 0;
  for (const row of input.perConversation) {
    const item = record(row);
    if (item.ok === true) okCount += 1;
    else failCount += 1;
  }
  return Object.freeze({ okCount, failCount });
}

function parseCurrentJob(
  provider: MigrationProfileProvider,
  value: unknown,
  now: number,
): MigrationReferenceFreeSyncJob | null {
  if (value == null) return null;
  const input = record(value);
  const rawStatus = String(input.status || '');
  if (rawStatus === 'finished') {
    if (input.provider != null && input.provider !== provider) invalid();
    const startedAt = nonNegativeInteger(input.startedAt);
    const updatedAt = nonNegativeInteger(input.updatedAt);
    const finishedAt = nonNegativeInteger(input.finishedAt);
    if (startedAt > updatedAt || updatedAt > finishedAt) invalid();
    const { okCount, failCount } = legacyFinishedCounts(input);
    return Object.freeze({ provider, status: 'done', startedAt, updatedAt, finishedAt, okCount, failCount });
  }

  const status = rawStatus;
  if (status !== 'running' && status !== 'done' && status !== 'aborted') invalid();
  if (input.provider !== provider) invalid();

  const startedAt = nonNegativeInteger(input.startedAt);
  const updatedAt = nonNegativeInteger(input.updatedAt);
  const okCount = nonNegativeInteger(input.okCount);
  const failCount = nonNegativeInteger(input.failCount);
  if (startedAt > updatedAt) invalid();

  if (status === 'done') {
    const finishedAt = nonNegativeInteger(input.finishedAt);
    if (updatedAt > finishedAt) invalid();
    return Object.freeze({ provider, status: 'done', startedAt, updatedAt, finishedAt, okCount, failCount });
  }

  const finishedAt = status === 'running' ? Math.max(now, updatedAt) : nonNegativeInteger(input.finishedAt);
  if (updatedAt > finishedAt) invalid();
  return Object.freeze({
    provider,
    status: 'aborted',
    startedAt,
    updatedAt,
    finishedAt,
    okCount,
    failCount,
    abortedReason: 'local_data_migration',
  });
}

function stableQueueStorageValue(entries: readonly MigrationProfileQueueEntry[]): unknown {
  return Object.freeze({
    version: AUTO_SYNC_STABLE_QUEUE_VERSION,
    entries: Object.freeze(entries.map((entry) => ({ ...entry }))),
  });
}

function sidecarWritePatch(patch: MigrationProfileReferencePatch): Record<string, unknown> {
  const items: Record<string, unknown> = {};
  for (const provider of MIGRATION_PROFILE_PROVIDERS) {
    items[AUTO_SYNC_QUEUE_STORAGE_KEYS[provider]] = stableQueueStorageValue(patch.queues[provider]);
    items[SYNC_JOB_STORAGE_KEYS[provider]] = patch.syncJobs[provider];
  }
  return items;
}

function patchFromStoredSidecars(
  expected: MigrationProfileReferencePatch,
  stored: Record<string, unknown>,
): MigrationProfileReferencePatch {
  const queues = {} as Record<MigrationProfileProvider, readonly MigrationProfileQueueEntry[]>;
  const syncJobs = {} as Record<MigrationProfileProvider, MigrationReferenceFreeSyncJob | null>;
  for (const provider of MIGRATION_PROFILE_PROVIDERS) {
    const queueKey = AUTO_SYNC_QUEUE_STORAGE_KEYS[provider];
    const jobKey = SYNC_JOB_STORAGE_KEYS[provider];
    if (!Object.hasOwn(stored, queueKey) || !Object.hasOwn(stored, jobKey)) invalid();
    const queue = withDiagnosticField(`profileReferences.${provider}.queue`, () =>
      parseStoredQueue(provider, stored[queueKey]),
    );
    if (queue.kind !== 'stable') invalid();
    queues[provider] = queue.entries;
    syncJobs[provider] = stored[jobKey] as MigrationReferenceFreeSyncJob | null;
  }
  return parseMigrationProfileReferencePatch({
    version: MIGRATION_PROFILE_REFERENCE_PATCH_VERSION,
    diagnostics: expected.diagnostics,
    queues,
    syncJobs,
  });
}

async function assertPatchDigest(
  patch: MigrationProfileReferencePatch,
  expectedDigest: string,
  digestProvider: DigestProvider,
): Promise<void> {
  if ((await migrationProfileReferencePatchDigest(patch, digestProvider)) !== expectedDigest) invalid();
}

export function createProfileReferenceRebase(dependencies: ProfileReferenceRebaseDependencies): ProfileReferenceRebase {
  const storage = dependencies.storage ?? { get: storageGet, set: storageSet };
  const now = dependencies.now ?? (() => Date.now());

  const buildPatch = async (): Promise<MigrationProfileReferencePatch> => {
    const stored = await storage.get([...MIGRATION_PROFILE_SIDECAR_STORAGE_KEYS]);
    const parsedQueues = new Map<MigrationProfileProvider, ParsedQueue>();
    const legacyIds = new Set<number>();
    for (const provider of MIGRATION_PROFILE_PROVIDERS) {
      const queue = withDiagnosticField(`profileReferences.${provider}.queue`, () =>
        parseStoredQueue(provider, stored[AUTO_SYNC_QUEUE_STORAGE_KEYS[provider]]),
      );
      parsedQueues.set(provider, queue);
      if (queue.kind === 'legacy') {
        for (const entry of queue.entries) legacyIds.add(entry.conversationId);
      }
    }

    const requestedLegacyIds = [...legacyIds].sort((left, right) => left - right);
    const resolutions = requestedLegacyIds.length
      ? await dependencies.resolveLegacyConversationReferences(requestedLegacyIds)
      : [];
    if (resolutions.length !== requestedLegacyIds.length) invalid();
    const byLegacyId = new Map<number, StableConversationReference | null>();
    for (const row of resolutions) {
      if (!Number.isSafeInteger(row.conversationId) || row.conversationId <= 0 || byLegacyId.has(row.conversationId))
        invalid();
      if (!requestedLegacyIds.includes(row.conversationId)) invalid();
      if (row.reference == null) byLegacyId.set(row.conversationId, null);
      else
        byLegacyId.set(
          row.conversationId,
          Object.freeze({ source: text(row.reference.source), conversationKey: text(row.reference.conversationKey) }),
        );
    }
    if (requestedLegacyIds.some((id) => !byLegacyId.has(id))) invalid();

    const queues = {} as Record<MigrationProfileProvider, readonly MigrationProfileQueueEntry[]>;
    const staleQueueEntriesDropped = {} as Record<MigrationProfileProvider, number>;
    const referencesToValidate = new Map<string, StableConversationReference>();

    for (const provider of MIGRATION_PROFILE_PROVIDERS) {
      const queue = parsedQueues.get(provider)!;
      const converted: MigrationProfileQueueEntry[] = [];
      let staleCount = 0;
      if (queue.kind === 'stable') converted.push(...queue.entries);
      else {
        for (const entry of queue.entries) {
          const reference = byLegacyId.get(entry.conversationId);
          if (reference == null) {
            staleCount += 1;
            continue;
          }
          converted.push({ ...reference, dueAt: entry.dueAt });
        }
      }
      const normalized = dedupeStableQueue(converted);
      if (normalized.length > MAX_MIGRATION_PROFILE_QUEUE_ITEMS) invalid();
      queues[provider] = normalized;
      staleQueueEntriesDropped[provider] = staleCount;
      for (const entry of normalized) referencesToValidate.set(identityKey(entry), entry);
    }

    for (const reference of referencesToValidate.values()) {
      if (!(await dependencies.validateNativeReference(reference))) {
        throw new LocalDataContractError('MIGRATION_RECEIPT_MISMATCH', { field: 'profileReferences.nativeReference' });
      }
    }

    const currentTime = nonNegativeInteger(now());
    const syncJobs = {} as Record<MigrationProfileProvider, MigrationReferenceFreeSyncJob | null>;
    for (const provider of MIGRATION_PROFILE_PROVIDERS) {
      syncJobs[provider] = withDiagnosticField(`profileReferences.${provider}.job`, () =>
        parseCurrentJob(provider, stored[SYNC_JOB_STORAGE_KEYS[provider]], currentTime),
      );
    }

    return parseMigrationProfileReferencePatch({
      version: MIGRATION_PROFILE_REFERENCE_PATCH_VERSION,
      diagnostics: { staleQueueEntriesDropped },
      queues,
      syncJobs,
    });
  };

  const verifyApplied = async (patch: MigrationProfileReferencePatch, expectedDigest: string): Promise<void> => {
    const expected = parseMigrationProfileReferencePatch(patch);
    await assertPatchDigest(expected, expectedDigest, dependencies.digestProvider);
    const stored = await storage.get([...MIGRATION_PROFILE_SIDECAR_STORAGE_KEYS]);
    const actual = patchFromStoredSidecars(expected, stored);
    await assertPatchDigest(actual, expectedDigest, dependencies.digestProvider);
  };

  const applyAndVerify = async (patch: MigrationProfileReferencePatch, expectedDigest: string): Promise<void> => {
    const expected = parseMigrationProfileReferencePatch(patch);
    await assertPatchDigest(expected, expectedDigest, dependencies.digestProvider);
    await storage.set(sidecarWritePatch(expected));
    await verifyApplied(expected, expectedDigest);
  };

  return Object.freeze({ buildPatch, applyAndVerify, verifyApplied });
}
