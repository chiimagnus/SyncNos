import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { FactsBackend } from '@services/local-data/facts-backend';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';
import {
  createMigrationCoordinator,
  type MigrationRuntimeEnvironment,
} from '@services/local-data/migration-coordinator';
import { createProfileReferenceRebase } from '@services/local-data/profile-reference-rebase';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  type FactsMigrationReceipt,
} from '@services/local-data/contracts';
import { sha256Hex } from '@services/local-data/digest';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
import { readMigrationJournal, type MigrationJournalRuntime } from '@platform/local-data/migration-journal';
import { readLegacyFactConversationReferences, verifyFactsEmpty } from '@platform/idb/facts-transfer';
import { FACTS_IDB_STORE_NAMES, DB_NAME, openDb } from '@platform/idb/schema';
import { requestToPromise, transactionDone } from '@platform/idb/transactions';
import { AUTO_SYNC_QUEUE_STORAGE_KEYS, AUTO_SYNC_STABLE_QUEUE_VERSION } from '@services/sync/auto-sync/auto-sync-keys';
import { SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-store';
import { nodeDigestProvider } from '../../../packages/syncnoscli/src/runtime/node-digest';
import { createLocalDataMigrationFixture } from '../../helpers/local-data-migration-fixture';

const MIGRATION_ID = '11111111-1111-4111-8111-111111111111';
let openedDatabases: IDBDatabase[] = [];

function environment(): MigrationRuntimeEnvironment {
  return { browser: 'chrome', officialIdentity: true, platform: 'unknown', supported: true };
}

function browserLocalStorage(initial: Record<string, unknown>) {
  const state: Record<string, unknown> = structuredClone(initial);
  return {
    state,
    storage: {
      async get(keys: string[]) {
        return Object.fromEntries(
          keys.filter((key) => Object.hasOwn(state, key)).map((key) => [key, structuredClone(state[key])]),
        );
      },
      async set(items: Record<string, unknown>) {
        for (const [key, value] of Object.entries(items)) state[key] = structuredClone(value);
      },
    },
  };
}

async function deleteDb(): Promise<void> {
  await requestToPromise(indexedDB.deleteDatabase(DB_NAME) as unknown as IDBRequest<unknown>);
}

async function seedFacts() {
  const fixture = createLocalDataMigrationFixture();
  const db = await openDb();
  openedDatabases.push(db);
  const transaction = db.transaction([...FACTS_IDB_STORE_NAMES], 'readwrite');
  for (const row of fixture.rows.conversations)
    await requestToPromise(transaction.objectStore('conversations').add(row));
  for (const row of fixture.rows.syncMappings)
    await requestToPromise(transaction.objectStore('sync_mappings').add(row));
  for (const row of fixture.rows.messages) await requestToPromise(transaction.objectStore('messages').add(row));
  for (const row of fixture.rows.imageCache) await requestToPromise(transaction.objectStore('image_cache').add(row));
  for (const row of fixture.rows.articleComments)
    await requestToPromise(transaction.objectStore('article_comments').add(row));
  await transactionDone(transaction);
  db.close();
  openedDatabases = openedDatabases.filter((item) => item !== db);
  return fixture;
}

async function receiptFor(manifest: any): Promise<FactsMigrationReceipt> {
  return {
    alreadyCommitted: false,
    commentAmbiguity: { groupCount: 0, samples: [] },
    complete: true,
    factCounts: manifest.factCounts,
    factsRevision: 1,
    manifestDigest: await sha256Hex(nodeDigestProvider, encodeCanonicalJson(manifest).bytes),
    migrationId: manifest.migrationId,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
  };
}

beforeEach(async () => {
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb();
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of openedDatabases.splice(0)) db.close();
  await deleteDb();
});

describe('local data migration end to end', () => {
  it('moves validated facts to the Host boundary, rebases only sidecar references, clears exactly the five source stores, and activates native epoch', async () => {
    const fixture = await seedFacts();
    const first = fixture.rows.conversations[0] as any;
    const second = fixture.rows.conversations[1] as any;
    const local = browserLocalStorage({
      [AUTO_SYNC_QUEUE_STORAGE_KEYS.notion]: { [first.id]: 100, [second.id]: 200, 9999: 300 },
      [AUTO_SYNC_QUEUE_STORAGE_KEYS.obsidian]: {
        version: AUTO_SYNC_STABLE_QUEUE_VERSION,
        entries: [{ source: first.source, conversationKey: first.conversationKey, dueAt: 150 }],
      },
      [AUTO_SYNC_QUEUE_STORAGE_KEYS.feishu]: { [first.id]: 250 },
      [SYNC_JOB_STORAGE_KEYS.notion]: {
        provider: 'notion',
        status: 'running',
        startedAt: 10,
        updatedAt: 20,
        finishedAt: null,
        okCount: 1,
        failCount: 0,
        conversationIds: [first.id],
        currentConversationId: first.id,
        currentConversationTitle: 'must disappear',
        warnings: [{ code: 'must disappear' }],
      },
      [SYNC_JOB_STORAGE_KEYS.obsidian]: {
        provider: 'obsidian',
        status: 'done',
        startedAt: 1,
        updatedAt: 2,
        finishedAt: 3,
        okCount: 4,
        failCount: 5,
        results: [{ conversationId: second.id }],
      },
      settings_theme: 'dark',
      notion_oauth_token: 'oauth-remains-browser-local',
      backup_history: [{ file: 'untouched.zip' }],
    });
    let now = 1_000;
    const journalRuntime: MigrationJournalRuntime = {
      digestProvider: nodeDigestProvider,
      now: () => ++now,
      randomUUID: () => MIGRATION_ID,
      storage: local.storage,
    };
    const gate = new FactsOperationGate({ readJournal: async () => await readMigrationJournal(journalRuntime) });
    await gate.initializeFromJournal();

    const importedReferences = new Set(
      fixture.rows.conversations.map((row: any) => `${String(row.source)}\u0000${String(row.conversationKey)}`),
    );
    const profileReferences = createProfileReferenceRebase({
      digestProvider: nodeDigestProvider,
      now: () => 1_100,
      resolveLegacyConversationReferences: async (ids) => await readLegacyFactConversationReferences(ids),
      storage: local.storage,
      validateNativeReference: async (reference) =>
        importedReferences.has(`${reference.source}\u0000${reference.conversationKey}`),
    });
    let committedReceipt: FactsMigrationReceipt | null = null;
    const nativeImport = vi.fn(async ({ produce }: any) => {
      const manifest = await produce({ onFrame: async () => {}, signal: new AbortController().signal });
      committedReceipt = await receiptFor(manifest);
      return committedReceipt;
    });
    const nativeRequest = vi.fn(async (command: string) => {
      if (command === 'GET_STATUS') {
        return { databaseUuid: 'private', factsRevision: 1, fts: { available: true, reason: null } };
      }
      if (command === 'GET_MIGRATION_RECEIPT') return committedReceipt;
      throw new Error(`unexpected command ${command}`);
    });
    const rearmSchedulers = vi.fn(async () => {});
    const onActivated = vi.fn(async () => {});
    const coordinator = createMigrationCoordinator({
      digestProvider: nodeDigestProvider,
      gate,
      journalRuntime,
      nativeImport,
      nativeRequest,
      profileReferences,
      readEnvironment: environment,
      rearmSchedulers,
      onActivated,
    });

    const status = await coordinator.start();

    expect(status.journal).toEqual({ mode: 'active', stage: 'active' });
    const activeJournal = await readMigrationJournal(journalRuntime);
    expect(activeJournal).toMatchObject({ mode: 'active', factsEpoch: `native:${MIGRATION_ID}` });
    expect(nativeImport).toHaveBeenCalledTimes(1);
    expect(committedReceipt?.factCounts).toEqual({
      conversations: 2,
      sync_mappings: 1,
      messages: 2,
      image_cache: 5,
      article_comments: 2,
    });
    expect(await verifyFactsEmpty()).toEqual({
      counts: {
        conversations: 0,
        sync_mappings: 0,
        messages: 0,
        image_cache: 0,
        article_comments: 0,
      },
      empty: true,
    });
    expect(local.state[AUTO_SYNC_QUEUE_STORAGE_KEYS.notion]).toEqual({
      version: AUTO_SYNC_STABLE_QUEUE_VERSION,
      entries: [
        { source: first.source, conversationKey: first.conversationKey, dueAt: 100 },
        { source: second.source, conversationKey: second.conversationKey, dueAt: 200 },
      ],
    });
    expect(local.state[AUTO_SYNC_QUEUE_STORAGE_KEYS.feishu]).toEqual({
      version: AUTO_SYNC_STABLE_QUEUE_VERSION,
      entries: [{ source: first.source, conversationKey: first.conversationKey, dueAt: 250 }],
    });
    expect(local.state[SYNC_JOB_STORAGE_KEYS.notion]).toEqual({
      provider: 'notion',
      status: 'aborted',
      startedAt: 10,
      updatedAt: 20,
      finishedAt: 1_100,
      okCount: 1,
      failCount: 0,
      abortedReason: 'local_data_migration',
    });
    expect(local.state[SYNC_JOB_STORAGE_KEYS.obsidian]).toEqual({
      provider: 'obsidian',
      status: 'done',
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
      okCount: 4,
      failCount: 5,
    });
    expect(local.state[SYNC_JOB_STORAGE_KEYS.feishu]).toBeNull();
    expect(local.state.settings_theme).toBe('dark');
    expect(local.state.notion_oauth_token).toBe('oauth-remains-browser-local');
    expect(local.state.backup_history).toEqual([{ file: 'untouched.zip' }]);
    expect(rearmSchedulers).toHaveBeenCalledTimes(1);
    expect(onActivated).toHaveBeenCalledTimes(1);

    const createIdbRepository = vi.fn(() => ({ backend: 'idb' }));
    const createNativeRepository = vi.fn(() => ({ backend: 'native' }));
    const backend = new FactsBackend({
      createIdbRepository,
      createNativeRepository,
      readJournal: async () => await readMigrationJournal(journalRuntime),
    });
    await expect(
      gate.runFactsOperation('old-epoch', async (lease) => await backend.open(lease, 'idb-v1')),
    ).rejects.toMatchObject({ code: 'STALE_BACKEND_EPOCH' });
    expect(createIdbRepository).not.toHaveBeenCalled();
    expect(createNativeRepository).not.toHaveBeenCalled();

    const current = await gate.runFactsOperation(
      'current-epoch',
      async (lease) => await backend.open(lease, `native:${MIGRATION_ID}`),
    );
    expect(current.mode).toBe('native');
    expect(createNativeRepository).toHaveBeenCalledTimes(1);
  });
});
