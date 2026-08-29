import { hasAsciiControlCharacter } from '@platform/validation/ascii-control';

type SyncMappingRecord = Record<string, unknown>;

const NOTION_CONTINUITY_FIELDS = [
  'notionPageId',
  'notionPageUrl',
  'notionWorkspaceSlug',
  'lastSyncedMessageKey',
  'lastSyncedSequence',
  'lastSyncedAt',
  'lastSyncedMessageUpdatedAt',
  'notionSections',
  'notionSectionCursors',
  'notionSectionDigests',
] as const;

const FEISHU_CONTINUITY_FIELDS = ['feishuDocId', 'feishuLastContentHash', 'feishuLastSyncedAt'] as const;
const GITHUB_CONTINUITY_FIELDS = [
  'githubRemoteKey',
  'githubManagedFiles',
  'githubProjectionFingerprint',
  'githubLastSyncedAt',
] as const;
const NOTION_NESTED_FIELDS = ['notionSections', 'notionSectionCursors', 'notionSectionDigests'] as const;

function isRecord(value: unknown): value is SyncMappingRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): SyncMappingRecord {
  return isRecord(value) ? value : {};
}

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function finiteNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function validNotionLastSyncedAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function validGithubLastSyncedAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function validFeishuLastSyncedAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function validObsidianRemoteWriteGeneration(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeObsidianRemoteWriteGeneration(target: SyncMappingRecord, ...sources: unknown[]): void {
  let generation: number | null = null;
  for (const source of sources) {
    const value = validObsidianRemoteWriteGeneration(asRecord(source).obsidianRemoteWriteGeneration);
    if (value == null) continue;
    generation = generation == null ? value : Math.max(generation, value);
  }
  if (generation == null) delete target.obsidianRemoteWriteGeneration;
  else target.obsidianRemoteWriteGeneration = generation;
}

function replaceGroup(target: SyncMappingRecord, source: SyncMappingRecord, fields: readonly string[]): void {
  for (const field of fields) {
    delete target[field];
    if (Object.prototype.hasOwnProperty.call(source, field)) target[field] = source[field];
  }
}

function isSafeGitRefName(value: string): boolean {
  if (!value || value === '@' || value.startsWith('/') || value.endsWith('/') || value.endsWith('.')) return false;
  if (value.includes('..') || value.includes('//') || value.includes('@{')) return false;
  if (hasAsciiControlCharacter(value) || value.includes(' ')) return false;
  if (['~', '^', ':', '?', '*', '[', '\\'].some((character) => value.includes(character))) return false;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment.startsWith('.') || segment.endsWith('.lock'))) return false;
  return true;
}

function normalizeGithubRemoteKey(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) return '';
  const prefix = 'github.com/';
  if (!value.startsWith(prefix)) return '';
  const at = value.indexOf('@', prefix.length);
  if (at <= prefix.length || at >= value.length - 1) return '';
  const repo = value.slice(prefix.length, at);
  const branch = value.slice(at + 1);
  const [owner, repository, ...extra] = repo.split('/');
  if (extra.length || !owner || !repository) return '';
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) return '';
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repository) || repository === '.' || repository === '..') return '';
  if (!isSafeGitRefName(branch)) return '';
  return value;
}

function isSafeRelativeGitPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value !== value.trim()) return false;
  if (value.startsWith('/') || value.includes('\\') || hasAsciiControlCharacter(value)) return false;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  const lower = value.toLowerCase();
  if (lower === '.github/workflows' || lower.startsWith('.github/workflows/')) return false;
  return true;
}

function normalizeGithubManagedFiles(value: unknown): SyncMappingRecord {
  if (!isRecord(value)) return {};
  const normalized: SyncMappingRecord = {};
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [path, rawMetadata] of entries) {
    if (!isSafeRelativeGitPath(path) || !isRecord(rawMetadata)) continue;
    const sha = rawMetadata.sha;
    const contentHash = rawMetadata.contentHash;
    const kind = rawMetadata.kind;
    if (typeof sha !== 'string' || !/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(sha)) continue;
    if (typeof contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(contentHash)) continue;
    if (kind !== 'markdown' && kind !== 'asset') continue;
    normalized[path] = { sha: sha.toLowerCase(), contentHash, kind };
  }
  return normalized;
}

export function readGithubContinuity(source: unknown): SyncMappingRecord {
  const record = asRecord(source);
  const remoteKey = normalizeGithubRemoteKey(record.githubRemoteKey);
  if (!remoteKey) return {};
  const normalized: SyncMappingRecord = { githubRemoteKey: remoteKey };
  if (Object.prototype.hasOwnProperty.call(record, 'githubManagedFiles')) {
    normalized.githubManagedFiles = normalizeGithubManagedFiles(record.githubManagedFiles);
  }
  const fingerprint = record.githubProjectionFingerprint;
  if (typeof fingerprint === 'string' && /^[0-9a-f]{64}$/.test(fingerprint)) {
    normalized.githubProjectionFingerprint = fingerprint;
  }
  const lastSyncedAt = validGithubLastSyncedAt(record.githubLastSyncedAt);
  if (lastSyncedAt != null) normalized.githubLastSyncedAt = lastSyncedAt;
  return normalized;
}

function readFeishuContinuity(source: unknown): SyncMappingRecord {
  const record = asRecord(source);
  const normalized: SyncMappingRecord = {};
  if (Object.prototype.hasOwnProperty.call(record, 'feishuDocId')) normalized.feishuDocId = record.feishuDocId;
  if (Object.prototype.hasOwnProperty.call(record, 'feishuLastContentHash')) {
    normalized.feishuLastContentHash = record.feishuLastContentHash;
  }
  const lastSyncedAt = validFeishuLastSyncedAt(record.feishuLastSyncedAt);
  if (lastSyncedAt != null) normalized.feishuLastSyncedAt = lastSyncedAt;
  return normalized;
}

function replaceFeishuGroup(target: SyncMappingRecord, source: unknown): void {
  replaceGroup(target, readFeishuContinuity(source), FEISHU_CONTINUITY_FIELDS);
}

function hasFeishuContinuityField(record: SyncMappingRecord): boolean {
  return FEISHU_CONTINUITY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(record, field));
}

function replaceGithubGroup(target: SyncMappingRecord, source: unknown): void {
  replaceGroup(target, readGithubContinuity(source), GITHUB_CONTINUITY_FIELDS);
}

function hasGithubContinuityField(record: SyncMappingRecord): boolean {
  return GITHUB_CONTINUITY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(record, field));
}

function syncMappingBusinessValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => syncMappingBusinessValueEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index]) return false;
    const key = leftKeys[index];
    if (!syncMappingBusinessValueEqual(left[key], right[key])) return false;
  }
  return true;
}

function syncMappingBusinessRecord(value: unknown): SyncMappingRecord {
  const next = { ...asRecord(value) };
  delete next.id;
  delete next.updatedAt;
  replaceFeishuGroup(next, value);
  replaceGithubGroup(next, value);
  normalizeObsidianRemoteWriteGeneration(next, value);
  return next;
}

export function areSyncMappingsBusinessEquivalent(left: unknown, right: unknown): boolean {
  return syncMappingBusinessValueEqual(syncMappingBusinessRecord(left), syncMappingBusinessRecord(right));
}

export function stripSyncMappingLocalId(record: unknown): SyncMappingRecord {
  const next = { ...asRecord(record) };
  delete next.id;
  return next;
}

export function mergeSyncMappingPatch(existing: unknown, patch: unknown): SyncMappingRecord {
  const base = asRecord(existing);
  const incoming = stripSyncMappingLocalId(patch);
  const hasNotionTargetPatch = Object.prototype.hasOwnProperty.call(incoming, 'notionPageId');
  const notionTargetChanged =
    hasNotionTargetPatch && safeString(base.notionPageId) !== safeString(incoming.notionPageId);
  const hasFeishuTargetPatch = Object.prototype.hasOwnProperty.call(incoming, 'feishuDocId');
  const feishuTargetChanged = hasFeishuTargetPatch && safeString(base.feishuDocId) !== safeString(incoming.feishuDocId);
  const hasFeishuPatch = hasFeishuContinuityField(incoming);
  const hasGithubTargetPatch = Object.prototype.hasOwnProperty.call(incoming, 'githubRemoteKey');
  const githubTargetChanged =
    hasGithubTargetPatch &&
    normalizeGithubRemoteKey(base.githubRemoteKey) !== normalizeGithubRemoteKey(incoming.githubRemoteKey);
  const hasGithubPatch = hasGithubContinuityField(incoming);
  const next: SyncMappingRecord = { ...base };
  if (notionTargetChanged) {
    for (const field of NOTION_CONTINUITY_FIELDS) delete next[field];
  }
  if (feishuTargetChanged) {
    for (const field of FEISHU_CONTINUITY_FIELDS) delete next[field];
  }
  if (githubTargetChanged) {
    for (const field of GITHUB_CONTINUITY_FIELDS) delete next[field];
  }
  Object.assign(next, incoming);
  if (hasFeishuPatch) {
    replaceFeishuGroup(next, feishuTargetChanged ? incoming : { ...base, ...incoming });
  }
  if (hasGithubPatch) {
    replaceGithubGroup(next, githubTargetChanged ? incoming : { ...base, ...incoming });
  }
  normalizeObsidianRemoteWriteGeneration(
    next,
    Object.prototype.hasOwnProperty.call(incoming, 'obsidianRemoteWriteGeneration') ? incoming : base,
  );

  const nestedBase = notionTargetChanged ? {} : base;
  for (const field of NOTION_NESTED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(incoming, field)) continue;
    const patchSections = incoming[field];
    if (!isRecord(patchSections)) {
      if (Object.prototype.hasOwnProperty.call(nestedBase, field)) next[field] = nestedBase[field];
      else delete next[field];
      continue;
    }

    const baseSections = asRecord(nestedBase[field]);
    const mergedSections: SyncMappingRecord = { ...baseSections };
    for (const [rawSectionId, sectionPatch] of Object.entries(patchSections)) {
      const sectionId = safeString(rawSectionId);
      if (!sectionId || !isRecord(sectionPatch)) continue;
      mergedSections[sectionId] = {
        ...asRecord(baseSections[sectionId]),
        ...sectionPatch,
      };
    }
    next[field] = mergedSections;
  }

  return next;
}

export function mergeSyncMappingForIdentityMove(
  target: unknown,
  legacy: unknown,
  identity: { source: unknown; conversationKey: unknown; fallbackNotionPageId?: unknown },
): SyncMappingRecord {
  const current = asRecord(target);
  const previous = asRecord(legacy);
  const hasTarget = Object.keys(current).length > 0;
  const next: SyncMappingRecord = hasTarget ? { ...previous, ...current } : { ...previous };

  const targetNotionPageId = safeString(current.notionPageId);
  const legacyNotionPageId = safeString(previous.notionPageId);
  const notionSource = targetNotionPageId ? current : legacyNotionPageId ? previous : hasTarget ? current : previous;
  replaceGroup(next, notionSource, NOTION_CONTINUITY_FIELDS);
  if (!safeString(next.notionPageId)) {
    const fallbackNotionPageId = safeString(identity?.fallbackNotionPageId);
    if (fallbackNotionPageId) next.notionPageId = fallbackNotionPageId;
  }

  const targetFeishuDocId = safeString(current.feishuDocId);
  const legacyFeishuDocId = safeString(previous.feishuDocId);
  const feishuSource = targetFeishuDocId ? current : legacyFeishuDocId ? previous : hasTarget ? current : previous;
  replaceFeishuGroup(next, feishuSource);

  const desiredSource = safeString(identity?.source);
  const desiredConversationKey = safeString(identity?.conversationKey);
  const targetGithubRemoteKey = normalizeGithubRemoteKey(current.githubRemoteKey);
  const legacyGithubRemoteKey = normalizeGithubRemoteKey(previous.githubRemoteKey);
  const legacyIdentityMatches =
    !!safeString(previous.source) &&
    !!safeString(previous.conversationKey) &&
    safeString(previous.source) === desiredSource &&
    safeString(previous.conversationKey) === desiredConversationKey;
  if (targetGithubRemoteKey) replaceGithubGroup(next, current);
  else if (legacyGithubRemoteKey && legacyIdentityMatches) replaceGithubGroup(next, previous);
  else replaceGithubGroup(next, {});
  normalizeObsidianRemoteWriteGeneration(next, current, previous);

  next.source = desiredSource;
  next.conversationKey = desiredConversationKey;
  if (hasTarget && Object.prototype.hasOwnProperty.call(current, 'id')) next.id = current.id;
  else if (Object.prototype.hasOwnProperty.call(previous, 'id')) next.id = previous.id;
  else delete next.id;

  return next;
}

export function mergeSyncMappingForImport(existing: unknown, incoming: unknown): SyncMappingRecord {
  const local = stripSyncMappingLocalId(existing);
  const imported = stripSyncMappingLocalId(incoming);

  // Generic metadata is conservative: keep local values and only fill missing keys from the imported snapshot.
  const next: SyncMappingRecord = { ...imported, ...local };

  const localNotionPageId = safeString(local.notionPageId);
  const importedNotionPageId = safeString(imported.notionPageId);
  let notionSource = local;
  if (!localNotionPageId) {
    notionSource = imported;
  } else if (!importedNotionPageId) {
    notionSource = local;
  } else if (localNotionPageId !== importedNotionPageId) {
    notionSource = local;
  } else {
    const localSyncedAt = validNotionLastSyncedAt(local.lastSyncedAt);
    const importedSyncedAt = validNotionLastSyncedAt(imported.lastSyncedAt);
    notionSource =
      localSyncedAt != null && importedSyncedAt != null && importedSyncedAt > localSyncedAt ? imported : local;
  }
  replaceGroup(next, notionSource, NOTION_CONTINUITY_FIELDS);

  const localFeishuDocId = safeString(local.feishuDocId);
  const importedFeishuDocId = safeString(imported.feishuDocId);
  if (!localFeishuDocId) {
    replaceFeishuGroup(next, imported);
  } else if (!importedFeishuDocId || importedFeishuDocId !== localFeishuDocId) {
    replaceFeishuGroup(next, local);
  } else if (safeString(local.feishuLastContentHash) === safeString(imported.feishuLastContentHash)) {
    replaceFeishuGroup(next, local);
    const localSyncedAt = validFeishuLastSyncedAt(local.feishuLastSyncedAt);
    const importedSyncedAt = validFeishuLastSyncedAt(imported.feishuLastSyncedAt);
    const maxSyncedAt = Math.max(localSyncedAt ?? -1, importedSyncedAt ?? -1);
    if (maxSyncedAt >= 0) next.feishuLastSyncedAt = maxSyncedAt;
    else delete next.feishuLastSyncedAt;
  } else {
    const localSyncedAt = validFeishuLastSyncedAt(local.feishuLastSyncedAt);
    const importedSyncedAt = validFeishuLastSyncedAt(imported.feishuLastSyncedAt);
    replaceFeishuGroup(
      next,
      localSyncedAt != null && importedSyncedAt != null && importedSyncedAt > localSyncedAt ? imported : local,
    );
  }

  const localGithubRemoteKey = normalizeGithubRemoteKey(local.githubRemoteKey);
  const importedGithubRemoteKey = normalizeGithubRemoteKey(imported.githubRemoteKey);
  let githubSource: SyncMappingRecord = {};
  if (!localGithubRemoteKey) {
    githubSource = importedGithubRemoteKey ? imported : {};
  } else if (!importedGithubRemoteKey || localGithubRemoteKey !== importedGithubRemoteKey) {
    githubSource = local;
  } else {
    const localSyncedAt = validGithubLastSyncedAt(local.githubLastSyncedAt);
    const importedSyncedAt = validGithubLastSyncedAt(imported.githubLastSyncedAt);
    githubSource =
      importedSyncedAt != null && (localSyncedAt == null || importedSyncedAt > localSyncedAt) ? imported : local;
  }
  replaceGithubGroup(next, githubSource);
  normalizeObsidianRemoteWriteGeneration(next, local, imported);

  const localUpdatedAt = finiteNumber(local.updatedAt);
  const importedUpdatedAt = finiteNumber(imported.updatedAt);
  if (localUpdatedAt != null || importedUpdatedAt != null) {
    next.updatedAt = Math.max(localUpdatedAt ?? -Infinity, importedUpdatedAt ?? -Infinity);
  }

  return next;
}
