import { describe, expect, it, vi } from 'vitest';

import { parseRuntimeStreamMessage } from '@platform/messaging/stream-port';
import { BackgroundStreamRouter } from '@services/local-data/background-stream-router';
import { FactsBackend } from '@services/local-data/facts-backend';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  MAX_STREAM_FRAME_BYTES,
  MAX_ZIP_STREAM_BYTES,
} from '@services/local-data/contracts';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';
import { MIGRATION_JOURNAL_STORAGE_KEY } from '@platform/local-data/migration-journal';
import { AUTO_SYNC_QUEUE_STORAGE_KEYS } from '@services/sync/auto-sync/auto-sync-keys';
import { registerBackupHandlers } from '@services/sync/backup/background-handlers';
import { buildBackupZipV2 } from '@services/sync/backup/export';
import {
  createEmptyImportStats,
  decodeBackupPortableFacts,
  emptyPortableBackupFacts,
  encodeBackupPortableFacts,
  type BackupFactsAdapter,
} from '@services/sync/backup/local-data';
import { createZipBlob, extractZipEntries } from '@services/sync/backup/zip-utils';
import { SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-keys';

const ACTIVE_EPOCH = 'native:11111111-1111-4111-8111-111111111111' as const;
const notStarted = { mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null } as const;
const active = { mode: 'active', journal: {} as any, factsEpoch: ACTIVE_EPOCH, error: null } as const;

function storageMock(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  const sets: Record<string, unknown>[] = [];
  const chrome = {
    runtime: { lastError: null as any },
    storage: {
      local: {
        get(keys: unknown, callback: (value: Record<string, unknown>) => void) {
          if (keys == null) callback({ ...store });
          else {
            const out: Record<string, unknown> = {};
            for (const key of Array.isArray(keys) ? keys : []) out[key] = (store as any)[key];
            callback(out);
          }
        },
        set(payload: Record<string, unknown>, callback: () => void) {
          sets.push({ ...payload });
          Object.assign(store, payload);
          callback();
        },
      },
    },
  };
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: chrome });
  Object.defineProperty(globalThis, 'browser', { configurable: true, value: undefined });
  return { sets, store };
}

function adapter(overrides: Partial<BackupFactsAdapter> = {}): BackupFactsAdapter {
  return {
    exportFacts: vi.fn(async () => ({ facts: emptyPortableBackupFacts(), warnings: [] })),
    importFacts: vi.fn(async () => createEmptyImportStats()),
    ...overrides,
  };
}

function createRuntimePortHarness() {
  const messageListeners = new Set<(message?: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  const posted: unknown[] = [];
  let disconnected = false;
  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    for (const listener of disconnectListeners) listener();
  };
  return {
    port: {
      disconnect,
      postMessage(message: unknown) {
        if (disconnected) throw new Error('port disconnected');
        posted.push(message);
      },
      onDisconnect: {
        addListener(listener: () => void) {
          disconnectListeners.add(listener);
        },
        removeListener(listener: () => void) {
          disconnectListeners.delete(listener);
        },
      },
      onMessage: {
        addListener(listener: (message?: unknown) => void) {
          messageListeners.add(listener);
        },
        removeListener(listener: (message?: unknown) => void) {
          messageListeners.delete(listener);
        },
      },
    },
    disconnect,
    emit(message: unknown) {
      if (disconnected) return;
      for (const listener of messageListeners) listener(message);
    },
    posted,
  };
}

function registerHarness(
  snapshot: typeof notStarted | typeof active,
  idb: BackupFactsAdapter,
  native: BackupFactsAdapter,
) {
  const handlers = new Map<string, any>();
  const broadcast = vi.fn();
  const backend = new FactsBackend<BackupFactsAdapter>({
    readJournal: async () => snapshot as any,
    createIdbRepository: () => idb,
    createNativeRepository: () => native,
  });
  registerBackupHandlers(
    { eventsHub: { broadcast } },
    {
      factsBackend: backend,
      streamRouter: {
        register(operation, handler) {
          handlers.set(operation, handler);
        },
      },
    },
  );
  const gate = new FactsOperationGate({ readJournal: async () => snapshot as any });
  gate.reopenForJournalState(snapshot as any);
  return { broadcast, gate, handler: handlers.get('zip-backup')! };
}

async function zipWithForeignRuntimePointers(): Promise<Uint8Array> {
  const safe = await buildBackupZipV2({
    facts: emptyPortableBackupFacts(),
    storageLocal: { notion_parent_page_id: 'allowed-page' },
    exportedAtMs: Date.UTC(2026, 7, 17),
  });
  const entries = await extractZipEntries(safe.blob);
  entries.set(
    'config/storage-local.json',
    new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        storageLocal: {
          notion_parent_page_id: 'allowed-page',
          [MIGRATION_JOURNAL_STORAGE_KEY]: { mode: 'active' },
          [AUTO_SYNC_QUEUE_STORAGE_KEYS.notion]: { entries: ['foreign'] },
          [AUTO_SYNC_QUEUE_STORAGE_KEYS.obsidian]: { entries: ['foreign'] },
          [AUTO_SYNC_QUEUE_STORAGE_KEYS.feishu]: { entries: ['foreign'] },
          [SYNC_JOB_STORAGE_KEYS.notion]: { id: 'foreign' },
          [SYNC_JOB_STORAGE_KEYS.obsidian]: { id: 'foreign' },
          [SYNC_JOB_STORAGE_KEYS.feishu]: { id: 'foreign' },
        },
      }),
    ),
  );
  const blob = await createZipBlob([...entries].map(([name, data]) => ({ name, data })));
  return new Uint8Array(await blob.arrayBuffer());
}

describe('backup local-data boundary', () => {
  it('round-trips portable image bytes without Base64 expansion, Blob, or IndexedDB state', () => {
    const facts = {
      ...emptyPortableBackupFacts(),
      imageCacheMode: 'indexed' as const,
      imageAssets: [
        {
          assetId: 7,
          uniqueKey: 'chatgpt||conversation-1',
          url: 'https://img.example/one.png',
          contentType: 'image/png',
          byteSize: 3,
          createdAt: 1,
          updatedAt: 2,
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
    };
    const encoded = encodeBackupPortableFacts(facts);
    const decoded = decodeBackupPortableFacts(encoded);
    expect([...decoded.imageAssets[0]!.bytes!]).toEqual([1, 2, 3]);
    expect(JSON.stringify(decoded)).not.toContain('blob');

    const largeBytes = new Uint8Array(1024 * 1024);
    largeBytes.fill(7);
    const largeEncoded = encodeBackupPortableFacts({
      ...emptyPortableBackupFacts(),
      imageCacheMode: 'indexed',
      imageAssets: [{ ...facts.imageAssets[0]!, byteSize: largeBytes.byteLength, bytes: largeBytes }],
    });
    expect(largeEncoded.byteLength).toBeLessThan(largeBytes.byteLength + 4096);
  });

  it('routes active export to Native only and leaves the journal untouched', async () => {
    const storage = storageMock({ [MIGRATION_JOURNAL_STORAGE_KEY]: { keep: true }, notion_parent_page_id: 'page' });
    const idb = adapter({
      exportFacts: vi.fn(async () => {
        throw new Error('IDB must not be read');
      }),
    });
    const native = adapter();
    const harness = registerHarness(active, idb, native);
    const sent = vi.fn(async (_bytes: Uint8Array) => {});

    await harness.gate.runFactsOperation('zip-backup:download', async (lease) => {
      await harness.handler.download({ lease, send: sent });
    });

    expect(native.exportFacts).toHaveBeenCalledOnce();
    expect(idb.exportFacts).not.toHaveBeenCalled();
    expect(sent).toHaveBeenCalledOnce();
    expect(storage.store[MIGRATION_JOURNAL_STORAGE_KEY]).toEqual({ keep: true });
  });

  it('routes old/new backup imports by journal mode and ignores foreign runtime pointers while applying safe settings', async () => {
    const storage = storageMock({ [MIGRATION_JOURNAL_STORAGE_KEY]: { keep: true } });
    const activeIdb = adapter({
      importFacts: vi.fn(async () => {
        throw new Error('IDB must not be written');
      }),
    });
    const activeNative = adapter();
    const activeHarness = registerHarness(active, activeIdb, activeNative);
    const zipBytes = await zipWithForeignRuntimePointers();

    await activeHarness.gate.runFactsOperation('zip-backup:upload', async (lease) => {
      await activeHarness.handler.upload({ bytes: zipBytes, lease });
    });
    expect(activeNative.importFacts).toHaveBeenCalledOnce();
    expect(activeIdb.importFacts).not.toHaveBeenCalled();
    expect(storage.store.notion_parent_page_id).toBe('allowed-page');
    expect(storage.store[MIGRATION_JOURNAL_STORAGE_KEY]).toEqual({ keep: true });
    for (const key of [...Object.values(AUTO_SYNC_QUEUE_STORAGE_KEYS), ...Object.values(SYNC_JOB_STORAGE_KEYS)]) {
      expect(storage.store[key]).toBeUndefined();
    }

    const legacyBytes = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        stores: { conversations: [], messages: [], sync_mappings: [] },
        storageLocal: {},
      }),
    );
    await activeHarness.gate.runFactsOperation('zip-backup:upload-legacy', async (lease) => {
      await activeHarness.handler.upload({ bytes: legacyBytes, lease });
    });
    expect(activeNative.importFacts).toHaveBeenCalledTimes(2);
    expect(activeIdb.importFacts).not.toHaveBeenCalled();

    const inactiveIdb = adapter();
    const inactiveNative = adapter({
      importFacts: vi.fn(async () => {
        throw new Error('Native must not be written');
      }),
    });
    const inactiveHarness = registerHarness(notStarted, inactiveIdb, inactiveNative);
    await inactiveHarness.gate.runFactsOperation('zip-backup:upload', async (lease) => {
      await inactiveHarness.handler.upload({ bytes: legacyBytes, lease });
    });
    expect(inactiveIdb.importFacts).toHaveBeenCalledOnce();
    expect(inactiveNative.importFacts).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized backup streams before any facts mutation', async () => {
    storageMock();
    const idb = adapter();
    const native = adapter();
    const harness = registerHarness(active, idb, native);

    await expect(
      harness.gate.runFactsOperation(
        'zip-backup:upload',
        async (lease) => await harness.handler.upload({ bytes: new TextEncoder().encode('{not-json'), lease }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(native.importFacts).not.toHaveBeenCalled();
    expect(idb.importFacts).not.toHaveBeenCalled();

    expect(() =>
      harness.handler.authorizeUpload({
        stream: { operation: 'zip-backup', declaredTotalBytes: MAX_ZIP_STREAM_BYTES + 1 },
      }),
    ).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
    expect(() =>
      parseRuntimeStreamMessage({
        type: 'open',
        requestId: 'zip-too-large',
        direction: 'upload',
        stream: { operation: 'zip-backup', declaredTotalBytes: MAX_ZIP_STREAM_BYTES + 1 },
      }),
    ).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
    expect(() =>
      parseRuntimeStreamMessage({
        type: 'frame',
        requestId: 'zip-frame-too-large',
        frame: { data: 'x'.repeat(MAX_STREAM_FRAME_BYTES + 1) },
      }),
    ).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
    expect(native.importFacts).not.toHaveBeenCalled();
  });

  it('stops cancelled, disconnected, and gate-blocked runtime ZIP uploads before any backup parser/import adapter', async () => {
    storageMock();
    const idb = adapter();
    const native = adapter();
    const backend = new FactsBackend<BackupFactsAdapter>({
      readJournal: async () => notStarted,
      createIdbRepository: () => idb,
      createNativeRepository: () => native,
    });
    const gate = new FactsOperationGate({ readJournal: async () => notStarted });
    gate.reopenForJournalState(notStarted);
    const streamRouter = new BackgroundStreamRouter(gate);
    registerBackupHandlers({}, { factsBackend: backend, streamRouter });

    const cancelled = createRuntimePortHarness();
    expect(streamRouter.registerPort(cancelled.port)).toBe(true);
    cancelled.emit({
      type: 'open',
      requestId: 'zip-cancelled',
      direction: 'upload',
      stream: { operation: 'zip-backup', declaredTotalBytes: 1 },
    });
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    cancelled.emit({
      type: 'frame',
      requestId: 'zip-cancelled',
      frame: {
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        sessionId,
        sequence: 0,
        type: 'begin',
        operation: 'zip-backup',
        declaredTotalBytes: 1,
      },
    });
    cancelled.emit({
      type: 'frame',
      requestId: 'zip-cancelled',
      frame: {
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        sessionId,
        sequence: 1,
        type: 'cancel',
        reason: 'user-cancelled',
      },
    });
    await vi.waitFor(() =>
      expect(cancelled.posted).toContainEqual(expect.objectContaining({ type: 'error', requestId: 'zip-cancelled' })),
    );

    const disconnected = createRuntimePortHarness();
    expect(streamRouter.registerPort(disconnected.port)).toBe(true);
    disconnected.emit({
      type: 'open',
      requestId: 'zip-eof',
      direction: 'upload',
      stream: { operation: 'zip-backup', declaredTotalBytes: 1 },
    });
    disconnected.disconnect();
    await gate.waitForDrained();

    gate.closeAdmissions();
    const blocked = createRuntimePortHarness();
    expect(streamRouter.registerPort(blocked.port)).toBe(true);
    blocked.emit({
      type: 'open',
      requestId: 'zip-blocked',
      direction: 'upload',
      stream: { operation: 'zip-backup', declaredTotalBytes: 1 },
    });
    await vi.waitFor(() =>
      expect(blocked.posted).toContainEqual(
        expect.objectContaining({
          type: 'error',
          requestId: 'zip-blocked',
          error: expect.objectContaining({ code: 'MIGRATION_IN_PROGRESS' }),
        }),
      ),
    );

    expect(idb.importFacts).not.toHaveBeenCalled();
    expect(native.importFacts).not.toHaveBeenCalled();
  });

  it('keeps migration drained behind an in-flight backup lease', async () => {
    storageMock();
    const harness = registerHarness(active, adapter(), adapter());
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const backup = harness.gate.runFactsOperation('zip-backup:download', async (lease) => {
      entered();
      await harness.handler.download({
        lease,
        send: async () => {
          await hold;
        },
      });
    });
    await enteredPromise;
    harness.gate.closeAdmissions();
    let drained = false;
    const wait = harness.gate.waitForDrained().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await backup;
    await wait;
    expect(drained).toBe(true);
  });
});
