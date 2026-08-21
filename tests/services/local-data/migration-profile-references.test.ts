import { describe, expect, it, vi } from 'vitest';

import { migrationProfileReferencePatchDigest } from '@platform/local-data/migration-journal';
import {
  createProfileReferenceRebase,
  MIGRATION_PROFILE_SIDECAR_STORAGE_KEYS,
  type ProfileReferenceStorage,
} from '@services/local-data/profile-reference-rebase';
import { AUTO_SYNC_QUEUE_STORAGE_KEYS, AUTO_SYNC_STABLE_QUEUE_VERSION } from '@services/sync/auto-sync/auto-sync-keys';
import { SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-store';
import { nodeDigestProvider } from '../../../packages/syncnoscli/src/runtime/node-digest';

function memoryStorage(initial: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = structuredClone(initial);
  const get = vi.fn(async (keys: string[]) =>
    Object.fromEntries(
      keys.filter((key) => Object.hasOwn(state, key)).map((key) => [key, structuredClone(state[key])]),
    ),
  );
  const set = vi.fn(async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) state[key] = structuredClone(value);
  });
  return { state, storage: { get, set } satisfies ProfileReferenceStorage, get, set };
}

function currentJobs() {
  return {
    [SYNC_JOB_STORAGE_KEYS.notion]: {
      provider: 'notion',
      id: 'job-with-private-id',
      instanceId: 'background-instance',
      status: 'running',
      startedAt: 10,
      updatedAt: 20,
      finishedAt: null,
      okCount: 2,
      failCount: 1,
      conversationIds: [10, 20],
      currentConversationId: 20,
      currentConversationTitle: 'private title',
      perConversation: [{ conversationId: 10, warnings: [{ code: 'private' }] }],
      extra: { targetConversationId: 700 },
    },
    [SYNC_JOB_STORAGE_KEYS.obsidian]: {
      provider: 'obsidian',
      status: 'done',
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
      okCount: 4,
      failCount: 5,
      conversationIds: [30],
      results: [{ conversationId: 900 }],
      warnings: ['private'],
    },
  };
}

describe('migration profile reference rebase', () => {
  it('converts all three bounded queues to stable identities, dedupes by later dueAt, drops only missing source rows, and sanitizes jobs', async () => {
    const storage = memoryStorage({
      [AUTO_SYNC_QUEUE_STORAGE_KEYS.notion]: { 10: 100, 20: 300, 999: 250 },
      [AUTO_SYNC_QUEUE_STORAGE_KEYS.obsidian]: {
        version: AUTO_SYNC_STABLE_QUEUE_VERSION,
        entries: [
          { source: 'gemini', conversationKey: 'stable', dueAt: 120 },
          { source: 'gemini', conversationKey: 'stable', dueAt: 500 },
        ],
      },
      [AUTO_SYNC_QUEUE_STORAGE_KEYS.feishu]: { 30: 200 },
      ...currentJobs(),
      oauth_token: 'must-not-be-read-or-written',
    });
    const resolveLegacyConversationReferences = vi.fn(async (ids: readonly number[]) => {
      expect(ids).toEqual([10, 20, 30, 999]);
      return [
        { conversationId: 10, reference: { source: 'chatgpt', conversationKey: 'same' } },
        { conversationId: 20, reference: { source: 'chatgpt', conversationKey: 'same' } },
        { conversationId: 30, reference: { source: 'web', conversationKey: 'article' } },
        { conversationId: 999, reference: null },
      ];
    });
    const validateNativeReference = vi.fn(async () => true);
    const rebase = createProfileReferenceRebase({
      digestProvider: nodeDigestProvider,
      now: () => 50,
      resolveLegacyConversationReferences,
      storage: storage.storage,
      validateNativeReference,
    });

    const patch = await rebase.buildPatch();

    expect(storage.get).toHaveBeenCalledWith([...MIGRATION_PROFILE_SIDECAR_STORAGE_KEYS]);
    expect(storage.set).not.toHaveBeenCalled();
    expect(patch.queues).toEqual({
      notion: [{ source: 'chatgpt', conversationKey: 'same', dueAt: 300 }],
      obsidian: [{ source: 'gemini', conversationKey: 'stable', dueAt: 500 }],
      feishu: [{ source: 'web', conversationKey: 'article', dueAt: 200 }],
    });
    expect(patch.diagnostics.staleQueueEntriesDropped).toEqual({ notion: 1, obsidian: 0, feishu: 0 });
    expect(patch.syncJobs.notion).toEqual({
      provider: 'notion',
      status: 'aborted',
      startedAt: 10,
      updatedAt: 20,
      finishedAt: 50,
      okCount: 2,
      failCount: 1,
      abortedReason: 'local_data_migration',
    });
    expect(patch.syncJobs.obsidian).toEqual({
      provider: 'obsidian',
      status: 'done',
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
      okCount: 4,
      failCount: 5,
    });
    expect(patch.syncJobs.feishu).toBeNull();
    expect(validateNativeReference).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(patch)).not.toMatch(
      /conversationId|currentConversation|instanceId|private title|warnings|results|targetConversationId/,
    );
  });

  it('consumes legacy finished provider jobs only at migration time and persists current reference-free done summaries', async () => {
    const legacyJob = (provider?: string) => ({
      ...(provider ? { provider } : {}),
      id: 'legacy-private-job',
      instanceId: 'legacy-background',
      status: 'finished',
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
      conversationIds: [10, 20],
      currentConversationId: 20,
      perConversation: [
        { conversationId: 10, ok: true, warnings: ['private'] },
        { conversationId: 20, ok: false, error: 'private error' },
      ],
    });
    const storage = memoryStorage({
      [SYNC_JOB_STORAGE_KEYS.notion]: legacyJob(),
      [SYNC_JOB_STORAGE_KEYS.obsidian]: legacyJob('obsidian'),
      [SYNC_JOB_STORAGE_KEYS.feishu]: legacyJob(),
    });
    const rebase = createProfileReferenceRebase({
      digestProvider: nodeDigestProvider,
      resolveLegacyConversationReferences: async () => [],
      storage: storage.storage,
      validateNativeReference: async () => true,
    });

    const patch = await rebase.buildPatch();
    for (const provider of ['notion', 'obsidian', 'feishu'] as const) {
      expect(patch.syncJobs[provider]).toEqual({
        provider,
        status: 'done',
        startedAt: 1,
        updatedAt: 2,
        finishedAt: 3,
        okCount: 1,
        failCount: 1,
      });
    }
    expect(JSON.stringify(patch.syncJobs)).not.toMatch(/conversationId|instanceId|private/);

    const digest = await migrationProfileReferencePatchDigest(patch, nodeDigestProvider);
    await rebase.applyAndVerify(patch, digest);
    for (const provider of ['notion', 'obsidian', 'feishu'] as const) {
      expect(storage.state[SYNC_JOB_STORAGE_KEYS[provider]]).toEqual(patch.syncJobs[provider]);
    }
  });

  it('blocks when a source row resolves but the matching imported Host facts do not contain that stable identity', async () => {
    const storage = memoryStorage({ [AUTO_SYNC_QUEUE_STORAGE_KEYS.notion]: { 10: 100 } });
    const rebase = createProfileReferenceRebase({
      digestProvider: nodeDigestProvider,
      resolveLegacyConversationReferences: async () => [
        { conversationId: 10, reference: { source: 'chatgpt', conversationKey: 'still-in-idb' } },
      ],
      storage: storage.storage,
      validateNativeReference: async () => false,
    });

    await expect(rebase.buildPatch()).rejects.toMatchObject({
      code: 'MIGRATION_RECEIPT_MISMATCH',
      diagnostics: { field: 'profileReferences.nativeReference' },
    });
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('writes exactly the six known sidecar keys in one batch, preserves unrelated storage, and verifies the journal digest', async () => {
    const storage = memoryStorage({
      setting_key: { untouched: true },
      oauth_token: 'secret-stays-local',
    });
    const rebase = createProfileReferenceRebase({
      digestProvider: nodeDigestProvider,
      resolveLegacyConversationReferences: async () => [],
      storage: storage.storage,
      validateNativeReference: async () => true,
    });
    const patch = await rebase.buildPatch();
    const digest = await migrationProfileReferencePatchDigest(patch, nodeDigestProvider);

    await rebase.applyAndVerify(patch, digest);

    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(Object.keys(storage.set.mock.calls[0]![0]).sort()).toEqual(
      [...MIGRATION_PROFILE_SIDECAR_STORAGE_KEYS].sort(),
    );
    expect(storage.state.setting_key).toEqual({ untouched: true });
    expect(storage.state.oauth_token).toBe('secret-stays-local');
    for (const provider of ['notion', 'obsidian', 'feishu'] as const) {
      expect(storage.state[AUTO_SYNC_QUEUE_STORAGE_KEYS[provider]]).toEqual({
        version: AUTO_SYNC_STABLE_QUEUE_VERSION,
        entries: [],
      });
      expect(storage.state[SYNC_JOB_STORAGE_KEYS[provider]]).toBeNull();
    }
  });

  it('detects partial or corrupted sidecar writes instead of treating them as cleanup-safe', async () => {
    const state: Record<string, unknown> = {};
    const storage: ProfileReferenceStorage = {
      async get(keys) {
        return Object.fromEntries(
          keys.filter((key) => Object.hasOwn(state, key)).map((key) => [key, structuredClone(state[key])]),
        );
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) {
          if (key === AUTO_SYNC_QUEUE_STORAGE_KEYS.obsidian) continue;
          state[key] = structuredClone(value);
        }
      },
    };
    const rebase = createProfileReferenceRebase({
      digestProvider: nodeDigestProvider,
      resolveLegacyConversationReferences: async () => [],
      storage,
      validateNativeReference: async () => true,
    });
    const patch = await rebase.buildPatch();
    const digest = await migrationProfileReferencePatchDigest(patch, nodeDigestProvider);

    await expect(rebase.applyAndVerify(patch, digest)).rejects.toMatchObject({ code: 'MIGRATION_VALIDATION_FAILED' });
  });

  it('does not treat a missing null job key as a successfully persisted sidecar', async () => {
    const state: Record<string, unknown> = {};
    const storage: ProfileReferenceStorage = {
      async get(keys) {
        return Object.fromEntries(
          keys.filter((key) => Object.hasOwn(state, key)).map((key) => [key, structuredClone(state[key])]),
        );
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) {
          if (key === SYNC_JOB_STORAGE_KEYS.feishu) continue;
          state[key] = structuredClone(value);
        }
      },
    };
    const rebase = createProfileReferenceRebase({
      digestProvider: nodeDigestProvider,
      resolveLegacyConversationReferences: async () => [],
      storage,
      validateNativeReference: async () => true,
    });
    const patch = await rebase.buildPatch();
    const digest = await migrationProfileReferencePatchDigest(patch, nodeDigestProvider);

    await expect(rebase.applyAndVerify(patch, digest)).rejects.toMatchObject({ code: 'MIGRATION_VALIDATION_FAILED' });
  });

  it('rejects malformed legacy queue handles instead of silently dropping ambiguous numeric state', async () => {
    const storage = memoryStorage({
      [AUTO_SYNC_QUEUE_STORAGE_KEYS.notion]: { '01': 100 },
    });
    const rebase = createProfileReferenceRebase({
      digestProvider: nodeDigestProvider,
      resolveLegacyConversationReferences: async () => [],
      storage: storage.storage,
      validateNativeReference: async () => true,
    });

    await expect(rebase.buildPatch()).rejects.toMatchObject({
      code: 'MIGRATION_VALIDATION_FAILED',
      diagnostics: { field: 'profileReferences.notion.queue' },
    });
    expect(storage.set).not.toHaveBeenCalled();
  });
});
