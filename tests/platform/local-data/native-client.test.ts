import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { connectNative, importNativeFacts, sendNativeMessage } from '@platform/local-data/native-client';
import type { NativeMessagingPort } from '@platform/local-data/native-port';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES,
  createHostFactsFailure,
  createHostFactsSuccess,
} from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator, sha256Hex } from '@services/local-data/digest';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
import { createFactsManifest, type FactsManifest } from '@services/local-data/facts-manifest';
import { nativeHostContract } from '@services/local-data/native-host-contract';
import { createNativeWireDataFrame } from '@services/local-data/native-wire';
import {
  createEmptyImportStats,
  emptyPortableBackupFacts,
  encodeBackupPortableExport,
  encodeBackupPortableFacts,
} from '@services/sync/backup/local-data';

const digestProvider = {
  async sha256(bytes: Uint8Array) {
    return createHash('sha256').update(bytes).digest('hex');
  },
};

function createPortHarness() {
  const messageListeners = new Set<(message?: unknown) => void>();
  const disconnectListeners = new Set<(message?: unknown) => void>();
  const disconnect = vi.fn();
  const postMessage = vi.fn();
  const port: NativeMessagingPort = {
    disconnect,
    postMessage,
    onMessage: {
      addListener(listener) {
        messageListeners.add(listener);
      },
      removeListener(listener) {
        messageListeners.delete(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.add(listener);
      },
      removeListener(listener) {
        disconnectListeners.delete(listener);
      },
    },
  };
  return {
    disconnect,
    emitDisconnect() {
      for (const listener of disconnectListeners) listener();
    },
    emitMessage(message: unknown) {
      for (const listener of messageListeners) listener(message);
    },
    port,
    postMessage,
  };
}

async function hostJsonFrames(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const sessionId = '550e8400-e29b-41d4-a716-446655440000';
  const digest = await OrderedFrameDigestAccumulator.create(digestProvider);
  const begin = {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sessionId,
    sequence: 0,
    type: 'begin' as const,
    operation: 'host-json' as const,
    declaredTotalBytes: bytes.byteLength,
  };
  const data = await createNativeWireDataFrame({
    bytes,
    offset: 0,
    provider: digestProvider,
    sequence: 1,
    sessionId,
  });
  await digest.append({ sequence: data.sequence, byteLength: data.byteLength, digest: data.sliceDigest });
  return [
    begin,
    data,
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 2,
      type: 'end' as const,
      digest: digest.finalize(),
    },
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 3,
      type: 'terminal' as const,
      status: 'ok' as const,
    },
  ];
}

async function backupFrames(bytes: Uint8Array) {
  const sessionId = '750e8400-e29b-41d4-a716-446655440000';
  const digest = await OrderedFrameDigestAccumulator.create(digestProvider);
  const data = await createNativeWireDataFrame({
    bytes,
    offset: 0,
    provider: digestProvider,
    sequence: 1,
    sessionId,
  });
  await digest.append({ sequence: data.sequence, byteLength: data.byteLength, digest: data.sliceDigest });
  return [
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 0,
      type: 'begin' as const,
      operation: 'zip-backup' as const,
      declaredTotalBytes: bytes.byteLength,
    },
    data,
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 2,
      type: 'end' as const,
      digest: digest.finalize(),
    },
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 3,
      type: 'terminal' as const,
      status: 'ok' as const,
    },
  ];
}

async function imageAssetFrames(bytes: Uint8Array) {
  const sessionId = '650e8400-e29b-41d4-a716-446655440000';
  const digest = await OrderedFrameDigestAccumulator.create(digestProvider);
  const data = await createNativeWireDataFrame({
    bytes,
    offset: 0,
    provider: digestProvider,
    sequence: 1,
    sessionId,
  });
  await digest.append({ sequence: data.sequence, byteLength: data.byteLength, digest: data.sliceDigest });
  return [
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 0,
      type: 'begin' as const,
      operation: 'image-asset' as const,
      declaredTotalBytes: bytes.byteLength,
    },
    data,
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 2,
      type: 'end' as const,
      digest: digest.finalize(),
    },
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 3,
      type: 'terminal' as const,
      status: 'ok' as const,
    },
  ];
}

const EMPTY_MIGRATION_COUNTS = Object.freeze({
  conversations: 0,
  sync_mappings: 0,
  messages: 0,
  image_cache: 0,
  article_comments: 0,
});

function emptyMigrationManifest(): FactsManifest {
  return createFactsManifest({
    migrationId: '11111111-1111-4111-8111-111111111111',
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    factCounts: EMPTY_MIGRATION_COUNTS,
    streamBytes: EMPTY_MIGRATION_COUNTS,
    orderedFrameDigest: '0'.repeat(64),
  });
}

async function migrationReceipt(manifest: FactsManifest) {
  return {
    alreadyCommitted: false,
    commentAmbiguity: { groupCount: 0, samples: [] },
    complete: true,
    factCounts: manifest.factCounts,
    factsRevision: 1,
    manifestDigest: await sha256Hex(digestProvider, encodeCanonicalJson(manifest).bytes),
    migrationId: manifest.migrationId,
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
  };
}

function captureSnapshotPayload(contentText: string) {
  const snapshot = {
    conversation: { source: 'chatgpt', conversationKey: 'native-large', sourceType: 'chat' },
    messages: [{ messageKey: 'm1', role: 'assistant', contentText }],
  };
  return {
    snapshot,
    transfer: {
      operation: 'capture-snapshot' as const,
      declaredTotalBytes: encodeCanonicalJson(snapshot).bytes.byteLength,
    },
  };
}

describe('Native Messaging client', () => {
  it('uses the canonical Host name for a bounded one-shot command', async () => {
    const send = vi.fn().mockResolvedValue(createHostFactsSuccess('small-request', { factsRevision: 7 }));

    await expect(
      sendNativeMessage<{ factsRevision: number }>({
        command: 'GET_FACTS_REVISION',
        payload: {},
        dependencies: {
          createRequestId: () => 'small-request',
          runtime: { sendNativeMessage: send },
        },
      }),
    ).resolves.toEqual({ factsRevision: 7 });

    expect(send).toHaveBeenCalledWith(nativeHostContract.host.name, {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      requestId: 'small-request',
      command: 'GET_FACTS_REVISION',
      payload: {},
    });
  });

  it('maps Host and runtime failures to P1 error codes without accepting a payload', async () => {
    await expect(
      sendNativeMessage({
        command: 'GET_STATUS',
        payload: {},
        dependencies: {
          createRequestId: () => 'host-failure',
          runtime: { sendNativeMessage: vi.fn().mockResolvedValue(createHostFactsFailure('host-failure', 'BUSY')) },
        },
      }),
    ).rejects.toMatchObject({ code: 'BUSY' });

    await expect(
      sendNativeMessage({
        command: 'GET_STATUS',
        payload: {},
        dependencies: {
          createRequestId: () => 'origin-failure',
          runtime: {
            sendNativeMessage: vi
              .fn()
              .mockRejectedValue(new Error('Access to the specified native messaging host is forbidden.')),
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
  });

  it('opens migration staging before starting the producer and returns only a full receipt', async () => {
    const harness = createPortHarness();
    const manifest = emptyMigrationManifest();
    const produce = vi.fn(async () => manifest);
    const operation = importNativeFacts({
      migrationId: manifest.migrationId,
      produce,
      dependencies: {
        createRequestId: () => 'migration-import',
        runtime: { connectNative: vi.fn(() => harness.port) },
      },
    });

    expect(produce).not.toHaveBeenCalled();
    expect(harness.postMessage).toHaveBeenCalledTimes(1);
    expect(harness.postMessage.mock.calls[0]?.[0]).toMatchObject({
      command: 'IMPORT_FACTS',
      requestId: 'migration-import',
      payload: {
        migrationId: manifest.migrationId,
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      },
    });

    harness.emitMessage(createHostFactsSuccess('migration-import', { accepted: true }));
    await vi.waitFor(() => expect(produce).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(harness.postMessage).toHaveBeenCalledTimes(2));
    expect(harness.postMessage.mock.calls[1]?.[0]).toEqual({ type: 'complete', manifest });

    const receipt = await migrationReceipt(manifest);
    harness.emitMessage(createHostFactsSuccess('migration-import', receipt));
    harness.emitDisconnect();
    await expect(operation).resolves.toEqual(receipt);
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('fails after queued import work drains when the Host disconnects without the final receipt', async () => {
    const harness = createPortHarness();
    const manifest = emptyMigrationManifest();
    const operation = importNativeFacts({
      migrationId: manifest.migrationId,
      produce: async () => manifest,
      dependencies: {
        createRequestId: () => 'migration-missing-receipt',
        runtime: { connectNative: vi.fn(() => harness.port) },
      },
    });

    harness.emitMessage(createHostFactsSuccess('migration-missing-receipt', { accepted: true }));
    await vi.waitFor(() => expect(harness.postMessage).toHaveBeenCalledTimes(2));
    expect(harness.postMessage.mock.calls[1]?.[0]).toEqual({ type: 'complete', manifest });

    harness.emitDisconnect();
    await expect(operation).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' });
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('aborts an accepted migration producer when the one-shot Native port disconnects', async () => {
    const harness = createPortHarness();
    let observedSignal: AbortSignal | null = null;
    const operation = importNativeFacts({
      migrationId: emptyMigrationManifest().migrationId,
      produce: async ({ signal }) => {
        observedSignal = signal;
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
        return emptyMigrationManifest();
      },
      dependencies: {
        createRequestId: () => 'migration-disconnect',
        runtime: { connectNative: vi.fn(() => harness.port) },
      },
    });
    harness.emitMessage(createHostFactsSuccess('migration-disconnect', { accepted: true }));
    await vi.waitFor(() => expect(observedSignal).not.toBeNull());

    harness.emitDisconnect();

    await expect(operation).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' });
    expect(observedSignal!.aborted).toBe(true);
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects generic IMPORT_FACTS connected calls so migration cannot fall through the host-json protocol', async () => {
    const connectNativeRuntime = vi.fn(() => createPortHarness().port);
    await expect(
      connectNative({
        command: 'IMPORT_FACTS',
        payload: {
          migrationId: emptyMigrationManifest().migrationId,
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
        },
        dependencies: { runtime: { connectNative: connectNativeRuntime } },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(connectNativeRuntime).not.toHaveBeenCalled();
  });

  it('requires the stream header before P1 wire frames and decodes only a completed terminal stream', async () => {
    const harness = createPortHarness();
    const operation = connectNative<{ items: string[] }>({
      command: 'CONVERSATION_BOOTSTRAP',
      payload: {},
      dependencies: {
        createRequestId: () => 'port-request',
        digestProvider,
        runtime: { connectNative: vi.fn(() => harness.port) },
      },
    });
    const frames = await hostJsonFrames({ items: ['first'] });

    harness.emitMessage(
      createHostFactsSuccess('port-request', {
        stream: {
          operation: 'host-json',
          declaredTotalBytes: new TextEncoder().encode('{"items":["first"]}').byteLength,
        },
      }),
    );
    for (const frame of frames) harness.emitMessage(frame);

    await expect(operation).resolves.toEqual({ items: ['first'] });
    expect(harness.postMessage).toHaveBeenCalledTimes(1);
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('uploads a large capture through bounded NativeWire frames instead of one Native Messaging payload', async () => {
    const harness = createPortHarness();
    const payload = captureSnapshotPayload('x'.repeat(MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES));
    const responseFrames = await hostJsonFrames({ saved: true });
    harness.postMessage.mockImplementation((message: unknown) => {
      if (!(message && typeof message === 'object' && (message as { type?: unknown }).type === 'terminal')) return;
      queueMicrotask(() => {
        harness.emitMessage(
          createHostFactsSuccess('large-capture', {
            stream: {
              operation: 'host-json',
              declaredTotalBytes: new TextEncoder().encode('{"saved":true}').byteLength,
            },
          }),
        );
        for (const frame of responseFrames) harness.emitMessage(frame);
      });
    });

    await expect(
      connectNative<{ saved: boolean }>({
        command: 'SAVE_CONVERSATION_SNAPSHOT',
        payload,
        dependencies: {
          createRequestId: () => 'large-capture',
          digestProvider,
          runtime: { connectNative: vi.fn(() => harness.port) },
        },
      }),
    ).resolves.toEqual({ saved: true });

    const sent = harness.postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(sent[0]).toMatchObject({
      requestId: 'large-capture',
      command: 'SAVE_CONVERSATION_SNAPSHOT',
      payload: { transfer: payload.transfer },
    });
    expect(sent[0]?.payload).not.toHaveProperty('snapshot');
    expect(sent[1]).toMatchObject({ type: 'begin', operation: 'capture-snapshot' });
    expect(sent.filter((message) => message.type === 'data')).not.toHaveLength(0);
    expect(sent.at(-1)).toMatchObject({ type: 'terminal', status: 'ok' });
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('uses the strict image header and raw NativeWire bytes for asset reads', async () => {
    const harness = createPortHarness();
    const bytes = Uint8Array.from([7, 8, 9]);
    const operation = connectNative<{
      backendAssetId: number;
      byteSize: number;
      bytes: Uint8Array;
      contentType: string;
    }>({
      command: 'GET_IMAGE_ASSET',
      payload: {
        owner: { source: 'chatgpt', conversationKey: 'asset-owner', backendConversationId: 4 },
        backendAssetId: 12,
        transfer: { operation: 'image-asset', declaredTotalBytes: 0 },
      },
      dependencies: {
        createRequestId: () => 'image-read',
        digestProvider,
        runtime: { connectNative: vi.fn(() => harness.port) },
      },
    });
    harness.emitMessage(
      createHostFactsSuccess('image-read', {
        asset: { backendAssetId: 12, byteSize: bytes.byteLength, contentType: 'image/png' },
        stream: { operation: 'image-asset', declaredTotalBytes: bytes.byteLength },
      }),
    );
    for (const frame of await imageAssetFrames(bytes)) harness.emitMessage(frame);

    await expect(operation).resolves.toEqual({
      backendAssetId: 12,
      byteSize: 3,
      bytes,
      contentType: 'image/png',
    });
    expect(harness.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'GET_IMAGE_ASSET', requestId: 'image-read' }),
    );
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('downloads portable backup facts through the dedicated zip-backup NativeWire operation', async () => {
    const harness = createPortHarness();
    const bytes = encodeBackupPortableExport({ facts: emptyPortableBackupFacts(), warnings: [] });
    const frames = await backupFrames(bytes);
    const operation = connectNative<Uint8Array>({
      command: 'EXPORT_BACKUP',
      payload: { transfer: { operation: 'zip-backup', declaredTotalBytes: 0 } },
      dependencies: {
        createRequestId: () => 'backup-export',
        digestProvider,
        runtime: { connectNative: vi.fn(() => harness.port) },
      },
    });

    harness.emitMessage(
      createHostFactsSuccess('backup-export', {
        stream: { operation: 'zip-backup', declaredTotalBytes: bytes.byteLength },
      }),
    );
    for (const frame of frames) harness.emitMessage(frame);

    await expect(operation).resolves.toEqual(bytes);
    expect(harness.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'EXPORT_BACKUP', requestId: 'backup-export' }),
    );
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('uploads portable backup facts as zip-backup bytes before reading compact Host stats', async () => {
    const harness = createPortHarness();
    const bytes = encodeBackupPortableFacts(emptyPortableBackupFacts());
    const stats = createEmptyImportStats();
    const responseFrames = await hostJsonFrames(stats);
    harness.postMessage.mockImplementation((message: unknown) => {
      if ((message as { type?: unknown })?.type !== 'terminal') return;
      queueMicrotask(() => {
        const statsBytes = new TextEncoder().encode(JSON.stringify(stats));
        harness.emitMessage(
          createHostFactsSuccess('backup-import', {
            stream: { operation: 'host-json', declaredTotalBytes: statsBytes.byteLength },
          }),
        );
        for (const frame of responseFrames) harness.emitMessage(frame);
      });
    });

    await expect(
      connectNative({
        command: 'IMPORT_BACKUP',
        payload: { transfer: { operation: 'zip-backup', declaredTotalBytes: bytes.byteLength } },
        uploadBytes: bytes,
        dependencies: {
          createRequestId: () => 'backup-import',
          digestProvider,
          runtime: { connectNative: vi.fn(() => harness.port) },
        },
      }),
    ).resolves.toEqual(stats);

    const sent = harness.postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(sent[0]).toMatchObject({
      command: 'IMPORT_BACKUP',
      payload: { transfer: { operation: 'zip-backup', declaredTotalBytes: bytes.byteLength } },
    });
    expect(JSON.stringify(sent[0])).not.toContain('uploadBytes');
    expect(sent[1]).toMatchObject({ type: 'begin', operation: 'zip-backup' });
    expect(sent.filter((message) => message.type === 'data')).not.toHaveLength(0);
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('uploads image bytes through NativeWire without adding them to the Host JSON request', async () => {
    const harness = createPortHarness();
    const bytes = Uint8Array.from([3, 2, 1]);
    const responseFrames = await hostJsonFrames({ backendAssetId: 13, byteSize: 3, contentType: 'image/png' });
    harness.postMessage.mockImplementation((message: unknown) => {
      if ((message as { type?: unknown })?.type !== 'terminal') return;
      queueMicrotask(() => {
        harness.emitMessage(
          createHostFactsSuccess('image-write', {
            stream: {
              operation: 'host-json',
              declaredTotalBytes: new TextEncoder().encode(
                '{"backendAssetId":13,"byteSize":3,"contentType":"image/png"}',
              ).byteLength,
            },
          }),
        );
        for (const frame of responseFrames) harness.emitMessage(frame);
      });
    });

    await expect(
      connectNative<{ backendAssetId: number }>({
        command: 'PUT_IMAGE_ASSET',
        payload: {
          owner: { source: 'chatgpt', conversationKey: 'asset-owner', backendConversationId: 4 },
          metadata: { url: 'https://example.com/image.png', contentType: 'image/png' },
          transfer: { operation: 'image-asset', declaredTotalBytes: bytes.byteLength },
        },
        uploadBytes: bytes,
        dependencies: {
          createRequestId: () => 'image-write',
          digestProvider,
          runtime: { connectNative: vi.fn(() => harness.port) },
        },
      }),
    ).resolves.toMatchObject({ backendAssetId: 13 });

    const sent = harness.postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(sent[0]).toMatchObject({
      command: 'PUT_IMAGE_ASSET',
      payload: {
        owner: { source: 'chatgpt', conversationKey: 'asset-owner', backendConversationId: 4 },
        metadata: { url: 'https://example.com/image.png', contentType: 'image/png' },
      },
    });
    expect(JSON.stringify(sent[0])).not.toContain('uploadBytes');
    expect(sent[1]).toMatchObject({ type: 'begin', operation: 'image-asset' });
    expect(sent.filter((message) => message.type === 'data')).not.toHaveLength(0);
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects wire bytes before the header and disconnects a failed one-shot port', async () => {
    const harness = createPortHarness();
    const operation = connectNative({
      command: 'CONVERSATION_BOOTSTRAP',
      payload: {},
      dependencies: {
        createRequestId: () => 'bad-port-request',
        digestProvider,
        runtime: { connectNative: vi.fn(() => harness.port) },
      },
    });
    const [begin] = await hostJsonFrames({ ignored: true });
    harness.emitMessage(begin);

    await expect(operation).rejects.toMatchObject({ code: 'PROTOCOL_MISMATCH' });
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not mix a post-header failure envelope with wire payloads', async () => {
    const harness = createPortHarness();
    const operation = connectNative({
      command: 'CONVERSATION_BOOTSTRAP',
      payload: {},
      dependencies: {
        createRequestId: () => 'mixed-port-request',
        digestProvider,
        runtime: { connectNative: vi.fn(() => harness.port) },
      },
    });
    harness.emitMessage(
      createHostFactsSuccess('mixed-port-request', {
        stream: { operation: 'host-json', declaredTotalBytes: 2 },
      }),
    );
    harness.emitMessage(createHostFactsFailure('mixed-port-request', 'HOST_UNAVAILABLE'));

    await expect(operation).rejects.toMatchObject({ code: 'PROTOCOL_MISMATCH' });
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects as soon as a Host stream is cancelled or terminates with an error', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    const begin = {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 0,
      type: 'begin' as const,
      operation: 'host-json' as const,
      declaredTotalBytes: 0,
    };
    const failedHarness = createPortHarness();
    const failed = connectNative({
      command: 'CONVERSATION_BOOTSTRAP',
      payload: {},
      dependencies: {
        createRequestId: () => 'terminal-error-request',
        digestProvider,
        runtime: { connectNative: vi.fn(() => failedHarness.port) },
      },
    });
    failedHarness.emitMessage(
      createHostFactsSuccess('terminal-error-request', {
        stream: { operation: 'host-json', declaredTotalBytes: 0 },
      }),
    );
    failedHarness.emitMessage(begin);
    failedHarness.emitMessage({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 1,
      type: 'terminal',
      status: 'error',
    });
    await expect(failed).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' });
    expect(failedHarness.disconnect).toHaveBeenCalledTimes(1);

    const cancelledHarness = createPortHarness();
    const cancelled = connectNative({
      command: 'CONVERSATION_BOOTSTRAP',
      payload: {},
      dependencies: {
        createRequestId: () => 'cancel-request',
        digestProvider,
        runtime: { connectNative: vi.fn(() => cancelledHarness.port) },
      },
    });
    cancelledHarness.emitMessage(
      createHostFactsSuccess('cancel-request', {
        stream: { operation: 'host-json', declaredTotalBytes: 0 },
      }),
    );
    cancelledHarness.emitMessage(begin);
    cancelledHarness.emitMessage({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 1,
      type: 'cancel',
      reason: 'cancelled',
    });
    await expect(cancelled).rejects.toMatchObject({ code: 'MIGRATION_VALIDATION_FAILED' });
    expect(cancelledHarness.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not open a port for a bounded one-shot command', async () => {
    const connect = vi.fn();

    await expect(
      connectNative({
        command: 'GET_STATUS',
        payload: {},
        dependencies: { runtime: { connectNative: connect } },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('maps a disconnected port to a Host availability error', async () => {
    const harness = createPortHarness();
    const operation = connectNative({
      command: 'CONVERSATION_BOOTSTRAP',
      payload: {},
      dependencies: {
        createRequestId: () => 'disconnect-port-request',
        runtime: { connectNative: vi.fn(() => harness.port) },
      },
    });
    harness.emitDisconnect();

    await expect(operation).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' });
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
  });
});
