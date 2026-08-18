import { createHash, webcrypto } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { getConversationImageAsset } from '@services/conversations/client/images';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { LOCAL_DATA_PROTOCOL_VERSION, MAX_IMAGE_ASSET_BYTES } from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator } from '@services/local-data/digest';
import type { FactsOperationLease } from '@services/local-data/facts-operation-gate';
import { createNativeWireDataFrame } from '@services/local-data/native-wire';

const runtimeMocks = vi.hoisted(() => ({ connectPort: vi.fn(), send: vi.fn() }));
const imageStorageMocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@platform/runtime/ports', () => ({ connectPort: runtimeMocks.connectPort }));
vi.mock('@platform/runtime/runtime', () => ({ send: runtimeMocks.send }));
vi.mock('@services/conversations/data/image-storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@services/conversations/data/image-storage')>()),
  createImageStorage: imageStorageMocks.create,
}));

const factsEpoch = 'native:550e8400-e29b-41d4-a716-446655440000' as const;
const reference = { source: 'chatgpt', conversationKey: 'image-thread', factsEpoch };
const digestProvider = {
  async sha256(bytes: Uint8Array) {
    return createHash('sha256').update(bytes).digest('hex');
  },
};

async function imageFrames(bytes: Uint8Array) {
  const sessionId = '550e8400-e29b-41d4-a716-446655440000';
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

function createPort(onOpen: (emit: (message: unknown) => void) => void) {
  const messageListeners = new Set<(message?: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  const posted: unknown[] = [];
  let disconnected = false;
  const emit = (message: unknown) => {
    if (disconnected) return;
    for (const listener of messageListeners) listener(message);
  };
  return {
    posted,
    port: {
      disconnect() {
        if (disconnected) return;
        disconnected = true;
        for (const listener of disconnectListeners) listener();
      },
      postMessage(message: unknown) {
        posted.push(message);
        if ((message as { type?: unknown })?.type === 'open') onOpen(emit);
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
  };
}

afterEach(() => {
  runtimeMocks.connectPort.mockReset();
  runtimeMocks.send.mockReset();
  imageStorageMocks.create.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('conversation image client', () => {
  it('accepts only a matching authenticated image stream before exposing a browser Blob', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const bytes = Uint8Array.from([1, 2, 3]);
    const frames = await imageFrames(bytes);
    const stream = createPort((emit) => {
      emit({
        type: 'header',
        requestId: 'image-stream',
        stream: { operation: 'image-asset', declaredTotalBytes: bytes.byteLength },
      });
      for (const frame of frames) emit({ type: 'frame', requestId: 'image-stream', frame });
      stream.port.disconnect();
    });
    runtimeMocks.connectPort.mockReturnValue(stream.port);
    runtimeMocks.send.mockResolvedValue({
      ok: true,
      data: {
        kind: 'stream',
        requestId: 'image-stream',
        contentType: 'image/png',
        stream: { operation: 'image-asset', declaredTotalBytes: bytes.byteLength },
      },
      error: null,
    });

    const asset = await getConversationImageAsset({ reference, assetId: 7 });

    expect(asset).toMatchObject({ id: 7, byteSize: 3, contentType: 'image/png' });
    expect(new Uint8Array(await asset!.blob.arrayBuffer())).toEqual(bytes);
    expect(runtimeMocks.send).toHaveBeenCalledWith('getConversationImageAsset', {
      source: reference.source,
      conversationKey: reference.conversationKey,
      factsEpoch,
      assetId: 7,
    });
    expect(stream.posted[0]).toMatchObject({
      type: 'open',
      requestId: 'image-stream',
      direction: 'download',
      operation: 'image-asset',
    });
  });

  it('rejects a disconnect after queued frames drain when the terminal frame never arrived', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const bytes = Uint8Array.from([1, 2, 3]);
    const frames = await imageFrames(bytes);
    const stream = createPort((emit) => {
      emit({
        type: 'header',
        requestId: 'missing-terminal',
        stream: { operation: 'image-asset', declaredTotalBytes: bytes.byteLength },
      });
      for (const frame of frames.slice(0, -1)) {
        emit({ type: 'frame', requestId: 'missing-terminal', frame });
      }
      stream.port.disconnect();
    });
    runtimeMocks.connectPort.mockReturnValue(stream.port);
    runtimeMocks.send.mockResolvedValue({
      ok: true,
      data: {
        kind: 'stream',
        requestId: 'missing-terminal',
        contentType: 'image/png',
        stream: { operation: 'image-asset', declaredTotalBytes: bytes.byteLength },
      },
      error: null,
    });

    await expect(getConversationImageAsset({ reference, assetId: 7 })).rejects.toMatchObject({
      code: 'HOST_UNAVAILABLE',
    });
  });

  it('rejects forged totals and oversize frames before retaining image bytes', async () => {
    runtimeMocks.send.mockResolvedValue({
      ok: false,
      data: null,
      error: { message: 'stale facts epoch', extra: { code: 'STALE_BACKEND_EPOCH' } },
    });
    await expect(getConversationImageAsset({ reference, assetId: 7 })).rejects.toMatchObject({
      code: 'STALE_BACKEND_EPOCH',
    });
    expect(runtimeMocks.connectPort).not.toHaveBeenCalled();

    runtimeMocks.send.mockResolvedValue({ ok: true, error: null });
    await expect(getConversationImageAsset({ reference, assetId: 7 })).rejects.toMatchObject({
      code: 'PROTOCOL_MISMATCH',
    });
    expect(runtimeMocks.connectPort).not.toHaveBeenCalled();

    runtimeMocks.send.mockResolvedValue({
      ok: true,
      data: {
        kind: 'stream',
        requestId: 'too-large',
        contentType: 'image/png',
        stream: { operation: 'image-asset', declaredTotalBytes: MAX_IMAGE_ASSET_BYTES + 1 },
      },
      error: null,
    });
    await expect(getConversationImageAsset({ reference, assetId: 7 })).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(runtimeMocks.connectPort).not.toHaveBeenCalled();

    const stream = createPort((emit) => {
      emit({
        type: 'header',
        requestId: 'forged-frame',
        stream: { operation: 'image-asset', declaredTotalBytes: 1 },
      });
      emit({
        type: 'frame',
        requestId: 'forged-frame',
        frame: { data: 'x'.repeat(512 * 1024 + 1) },
      });
    });
    runtimeMocks.connectPort.mockReturnValue(stream.port);
    runtimeMocks.send.mockResolvedValue({
      ok: true,
      data: {
        kind: 'stream',
        requestId: 'forged-frame',
        contentType: 'image/png',
        stream: { operation: 'image-asset', declaredTotalBytes: 1 },
      },
      error: null,
    });
    await expect(getConversationImageAsset({ reference, assetId: 7 })).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    });
  });
});

describe('conversation image background routing', () => {
  it('revalidates epoch and owner before publishing one bounded image stream', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => '550e8400-e29b-41d4-a716-446655440000' });
    const handlers = new Map<string, any>();
    const streamRouter = { register: (operation: string, handler: unknown) => handlers.set(operation, handler) };
    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    const repository = {
      getConversationByReference: vi.fn(async () => ({
        id: 42,
        source: reference.source,
        conversationKey: reference.conversationKey,
      })),
    };
    const storage = {
      getAsset: vi.fn(async () => ({
        id: 7,
        conversationId: 42,
        byteSize: 3,
        contentType: 'image/png',
        blob: new Blob([Uint8Array.from([4, 5, 6])], { type: 'image/png' }),
        url: 'https://example.com/image.png',
      })),
    };
    imageStorageMocks.create.mockReturnValue(storage);
    registerConversationHandlers(router as any, {
      conversationReadRunner: {
        run: async ({ expectedFactsEpoch, read }: any) => {
          if (expectedFactsEpoch !== factsEpoch) throw new Error('unexpected epoch');
          return await read({
            factsEpoch,
            lease: {} as FactsOperationLease,
            mode: 'native',
            repository,
          });
        },
      },
      onConversationChanged: async () => {},
      streamRouter,
    });

    const preflight = await router.__handleMessageForTests({
      type: 'getConversationImageAsset',
      source: reference.source,
      conversationKey: reference.conversationKey,
      factsEpoch,
      assetId: 7,
    });
    expect(preflight).toMatchObject({
      ok: true,
      data: { kind: 'stream', contentType: 'image/png', stream: { operation: 'image-asset', declaredTotalBytes: 3 } },
    });
    expect(storage.getAsset).toHaveBeenCalledWith(
      { source: reference.source, conversationKey: reference.conversationKey, conversationId: 42 },
      7,
    );

    const sent: Uint8Array[] = [];
    await handlers.get('image-asset').download({
      requestId: preflight.data.requestId,
      send: async (bytes: Uint8Array) => sent.push(bytes),
    });
    expect(sent).toEqual([Uint8Array.from([4, 5, 6])]);
    await expect(
      handlers.get('image-asset').download({ requestId: preflight.data.requestId, send: async () => {} }),
    ).rejects.toMatchObject({ code: 'STALE_REFERENCE' });

    repository.getConversationByReference.mockResolvedValue(null);
    const rejected = await router.__handleMessageForTests({
      type: 'getConversationImageAsset',
      source: reference.source,
      conversationKey: reference.conversationKey,
      factsEpoch,
      assetId: 7,
    });
    expect(rejected).toMatchObject({ ok: false, error: { extra: { code: 'STALE_REFERENCE' } } });
  });
});
