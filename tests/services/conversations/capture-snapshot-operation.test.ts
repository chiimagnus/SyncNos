import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
import { BackgroundStreamRouter } from '@services/local-data/background-stream-router';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  MAX_CAPTURE_SNAPSHOT_BYTES,
  MAX_NATIVE_IMAGE_SLICE_BYTES,
  MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES,
  MAX_STREAM_FRAME_BYTES,
  type ConversationCaptureSnapshot,
} from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator } from '@services/local-data/digest';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';
import { createNativeWireDataFrame } from '@services/local-data/native-wire';

const streamRepositoryMocks = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@services/conversations/data/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@services/conversations/data/storage')>()),
  openConversationReadRepository: streamRepositoryMocks.open,
}));

const digestProvider = {
  async sha256(bytes: Uint8Array) {
    return createHash('sha256').update(bytes).digest('hex');
  },
};

const notStarted = {
  mode: 'not_started',
  journal: null,
  factsEpoch: 'idb-v1',
  error: null,
} as const;

function snapshot(body = 'hello'): ConversationCaptureSnapshot {
  return {
    conversation: {
      sourceType: 'chat',
      source: 'gemini',
      conversationKey: 'capture-1',
      title: 'Capture',
      url: 'https://gemini.google.com/app/capture-1',
    },
    messages: [
      {
        messageKey: 'm-1',
        role: 'user',
        contentText: body,
        sequence: 1,
      },
    ],
    mode: 'snapshot',
    diff: null,
  };
}

async function wireFrames(bytes: Uint8Array) {
  const sessionId = '550e8400-e29b-41d4-a716-446655440000';
  const digest = await OrderedFrameDigestAccumulator.create(digestProvider);
  const frames: unknown[] = [
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: 0,
      type: 'begin' as const,
      operation: 'capture-snapshot' as const,
      declaredTotalBytes: bytes.byteLength,
    },
  ];
  let sequence = 1;
  for (let offset = 0; offset < bytes.byteLength; offset += MAX_NATIVE_IMAGE_SLICE_BYTES) {
    const frame = await createNativeWireDataFrame({
      bytes: bytes.subarray(offset, Math.min(bytes.byteLength, offset + MAX_NATIVE_IMAGE_SLICE_BYTES)),
      offset,
      provider: digestProvider,
      sequence: sequence++,
      sessionId,
    });
    await digest.append({ sequence: frame.sequence, byteLength: frame.byteLength, digest: frame.sliceDigest });
    frames.push(frame);
  }
  frames.push(
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence: sequence++,
      type: 'end' as const,
      digest: digest.finalize(),
    },
    {
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      sessionId,
      sequence,
      type: 'terminal' as const,
      status: 'ok' as const,
    },
  );
  return frames;
}

function createStreamPort() {
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
        if (disconnected) throw new Error('stream disconnected');
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
    emit(message: unknown) {
      if (disconnected) return;
      for (const listener of messageListeners) listener(message);
    },
    posted,
  };
}

async function createHarness() {
  const gate = new FactsOperationGate({ readJournal: async () => notStarted });
  await gate.initializeFromJournal();
  const streamRouter = new BackgroundStreamRouter(gate);
  const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
  const order: string[] = [];
  const repository = {
    saveConversationSnapshot: vi.fn(async (input: ConversationCaptureSnapshot) => {
      order.push('save');
      return {
        conversation: { ...input.conversation, id: 41 },
        isNew: true,
        upserted: input.messages.length,
        deleted: 0,
      };
    }),
  };
  const onConversationChanged = vi.fn(async () => {
    order.push('sync');
  });
  streamRepositoryMocks.open.mockResolvedValue({ mode: 'native', repository });
  registerConversationHandlers(router as any, {
    conversationReadRunner: {
      run: async ({ read }: any) => await read({ mode: 'native', repository }),
    },
    onConversationChanged,
    streamRouter,
  });
  router.eventsHub.broadcast = vi.fn(() => {
    order.push('broadcast');
  });
  return { gate, onConversationChanged, order, repository, router, streamRouter };
}

describe('capture snapshot operation', () => {
  it('persists a small capture once, then awaits sync before broadcasting', async () => {
    const harness = await createHarness();
    const value = snapshot();
    const bytes = encodeCanonicalJson(value).bytes;

    const response = await harness.router.__handleMessageForTests({
      type: 'saveConversationSnapshot',
      snapshot: value,
      transfer: { operation: 'capture-snapshot', declaredTotalBytes: bytes.byteLength },
    });

    expect(response).toEqual({ ok: true, data: { conversationId: 41, isNew: true }, error: null });
    expect(harness.repository.saveConversationSnapshot).toHaveBeenCalledOnce();
    expect(harness.onConversationChanged).toHaveBeenCalledOnce();
    expect(harness.order).toEqual(['save', 'sync', 'broadcast']);
  });

  it('streams a single large message as canonical UTF-8 frames before the only facts write', async () => {
    const harness = await createHarness();
    const value = snapshot('x'.repeat(MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES));
    const bytes = encodeCanonicalJson(value).bytes;
    expect(bytes.byteLength).toBeGreaterThan(MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES);

    const header = await harness.router.__handleMessageForTests({
      type: 'saveConversationSnapshot',
      transfer: { operation: 'capture-snapshot', declaredTotalBytes: bytes.byteLength },
    });
    expect(header.ok).toBe(true);
    const preflight = header.data as any;
    expect(preflight).toMatchObject({ kind: 'stream', stream: { operation: 'capture-snapshot' } });

    const stream = createStreamPort();
    expect(harness.streamRouter.registerPort(stream.port)).toBe(true);
    stream.emit({
      type: 'open',
      requestId: preflight.requestId,
      direction: 'upload',
      stream: preflight.stream,
    });
    for (const frame of await wireFrames(bytes)) {
      stream.emit({ type: 'frame', requestId: preflight.requestId, frame });
    }

    await vi.waitFor(() => expect(harness.repository.saveConversationSnapshot).toHaveBeenCalledOnce());
    expect(harness.repository.saveConversationSnapshot).toHaveBeenCalledWith(value);
    await vi.waitFor(() =>
      expect(stream.posted).toContainEqual({
        type: 'complete',
        requestId: preflight.requestId,
        data: { conversationId: 41, isNew: true },
      }),
    );
  });

  it('bounds unopened large capture preflights', async () => {
    vi.useFakeTimers();
    try {
      const harness = await createHarness();
      const bytes = encodeCanonicalJson(snapshot('x'.repeat(MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES))).bytes;
      const payload = {
        type: 'saveConversationSnapshot',
        transfer: { operation: 'capture-snapshot', declaredTotalBytes: bytes.byteLength },
      };
      for (let count = 0; count < 8; count += 1) {
        await expect(harness.router.__handleMessageForTests(payload)).resolves.toMatchObject({ ok: true });
      }
      await expect(harness.router.__handleMessageForTests(payload)).resolves.toMatchObject({
        ok: false,
        error: { extra: { code: 'BUSY' } },
      });
    } finally {
      vi.advanceTimersByTime(60_000);
      vi.useRealTimers();
    }
  });

  it('rejects oversized, cancelled, disconnected, and oversized-frame streams before facts writes', async () => {
    const oneShot = await createHarness();
    const oneShotSnapshot = snapshot('x'.repeat(MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES));
    const oneShotBytes = encodeCanonicalJson(oneShotSnapshot).bytes;
    const oneShotResponse = await oneShot.router.__handleMessageForTests({
      type: 'saveConversationSnapshot',
      snapshot: oneShotSnapshot,
      transfer: { operation: 'capture-snapshot', declaredTotalBytes: oneShotBytes.byteLength },
    });
    expect(oneShotResponse).toMatchObject({ ok: false, error: { extra: { code: 'PAYLOAD_TOO_LARGE' } } });
    expect(oneShot.repository.saveConversationSnapshot).not.toHaveBeenCalled();

    const forged = await createHarness();
    const forgedSnapshot = snapshot();
    const forgedResponse = await forged.router.__handleMessageForTests({
      type: 'saveConversationSnapshot',
      snapshot: forgedSnapshot,
      transfer: {
        operation: 'capture-snapshot',
        declaredTotalBytes: encodeCanonicalJson(forgedSnapshot).bytes.byteLength + 1,
      },
    });
    expect(forgedResponse).toMatchObject({ ok: false, error: { extra: { code: 'PROTOCOL_MISMATCH' } } });
    expect(forged.repository.saveConversationSnapshot).not.toHaveBeenCalled();

    const oversized = await createHarness();
    const oversizedResponse = await oversized.router.__handleMessageForTests({
      type: 'saveConversationSnapshot',
      transfer: { operation: 'capture-snapshot', declaredTotalBytes: MAX_CAPTURE_SNAPSHOT_BYTES + 1 },
    });
    expect(oversizedResponse).toMatchObject({ ok: false, error: { extra: { code: 'PAYLOAD_TOO_LARGE' } } });
    expect(oversized.repository.saveConversationSnapshot).not.toHaveBeenCalled();

    const cancelled = await createHarness();
    const bytes = encodeCanonicalJson(snapshot('x'.repeat(MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES))).bytes;
    const header = await cancelled.router.__handleMessageForTests({
      type: 'saveConversationSnapshot',
      transfer: { operation: 'capture-snapshot', declaredTotalBytes: bytes.byteLength },
    });
    const preflight = header.data as any;
    const cancelPort = createStreamPort();
    cancelled.streamRouter.registerPort(cancelPort.port);
    cancelPort.emit({
      type: 'open',
      requestId: preflight.requestId,
      direction: 'upload',
      stream: preflight.stream,
    });
    cancelPort.emit({
      type: 'frame',
      requestId: preflight.requestId,
      frame: {
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        sequence: 0,
        type: 'begin',
        operation: 'capture-snapshot',
        declaredTotalBytes: bytes.byteLength,
      },
    });
    cancelPort.emit({
      type: 'frame',
      requestId: preflight.requestId,
      frame: {
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        sequence: 1,
        type: 'cancel',
        reason: 'cancelled',
      },
    });
    await cancelled.gate.waitForDrained();
    expect(cancelled.repository.saveConversationSnapshot).not.toHaveBeenCalled();

    const disconnected = await createHarness();
    const disconnectHeader = await disconnected.router.__handleMessageForTests({
      type: 'saveConversationSnapshot',
      transfer: { operation: 'capture-snapshot', declaredTotalBytes: bytes.byteLength },
    });
    const disconnectPreflight = disconnectHeader.data as any;
    const disconnectPort = createStreamPort();
    disconnected.streamRouter.registerPort(disconnectPort.port);
    disconnectPort.emit({
      type: 'open',
      requestId: disconnectPreflight.requestId,
      direction: 'upload',
      stream: disconnectPreflight.stream,
    });
    disconnectPort.emit({
      type: 'frame',
      requestId: disconnectPreflight.requestId,
      frame: {
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        sequence: 0,
        type: 'begin',
        operation: 'capture-snapshot',
        declaredTotalBytes: bytes.byteLength,
      },
    });
    disconnectPort.port.disconnect();
    await disconnected.gate.waitForDrained();
    expect(disconnected.repository.saveConversationSnapshot).not.toHaveBeenCalled();

    const badDigest = await createHarness();
    const digestHeader = await badDigest.router.__handleMessageForTests({
      type: 'saveConversationSnapshot',
      transfer: { operation: 'capture-snapshot', declaredTotalBytes: bytes.byteLength },
    });
    const digestPreflight = digestHeader.data as any;
    const digestPort = createStreamPort();
    badDigest.streamRouter.registerPort(digestPort.port);
    digestPort.emit({
      type: 'open',
      requestId: digestPreflight.requestId,
      direction: 'upload',
      stream: digestPreflight.stream,
    });
    const frames = await wireFrames(bytes);
    const endIndex = frames.findIndex((frame: any) => frame.type === 'end');
    frames[endIndex] = { ...(frames[endIndex] as Record<string, unknown>), digest: '0'.repeat(64) };
    for (const frame of frames) {
      digestPort.emit({ type: 'frame', requestId: digestPreflight.requestId, frame });
    }
    await badDigest.gate.waitForDrained();
    expect(badDigest.repository.saveConversationSnapshot).not.toHaveBeenCalled();

    const forgedDescriptor = await createHarness();
    const descriptorHeader = await forgedDescriptor.router.__handleMessageForTests({
      type: 'saveConversationSnapshot',
      transfer: { operation: 'capture-snapshot', declaredTotalBytes: bytes.byteLength },
    });
    const descriptorPreflight = descriptorHeader.data as any;
    const descriptorPort = createStreamPort();
    forgedDescriptor.streamRouter.registerPort(descriptorPort.port);
    descriptorPort.emit({
      type: 'open',
      requestId: descriptorPreflight.requestId,
      direction: 'upload',
      stream: {
        ...descriptorPreflight.stream,
        declaredTotalBytes: descriptorPreflight.stream.declaredTotalBytes + 1,
      },
    });
    await vi.waitFor(() =>
      expect(descriptorPort.posted).toContainEqual(
        expect.objectContaining({ type: 'error', error: expect.objectContaining({ code: 'PROTOCOL_MISMATCH' }) }),
      ),
    );
    await forgedDescriptor.gate.waitForDrained();
    expect(forgedDescriptor.repository.saveConversationSnapshot).not.toHaveBeenCalled();

    const oversizedFrame = await createHarness();
    const frameHeader = await oversizedFrame.router.__handleMessageForTests({
      type: 'saveConversationSnapshot',
      transfer: { operation: 'capture-snapshot', declaredTotalBytes: bytes.byteLength },
    });
    const framePreflight = frameHeader.data as any;
    const framePort = createStreamPort();
    oversizedFrame.streamRouter.registerPort(framePort.port);
    framePort.emit({
      type: 'open',
      requestId: framePreflight.requestId,
      direction: 'upload',
      stream: framePreflight.stream,
    });
    framePort.emit({
      type: 'frame',
      requestId: framePreflight.requestId,
      frame: { data: 'x'.repeat(MAX_STREAM_FRAME_BYTES) },
    });
    await vi.waitFor(() =>
      expect(framePort.posted).toContainEqual(
        expect.objectContaining({ type: 'error', error: expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }) }),
      ),
    );
    await oversizedFrame.gate.waitForDrained();
    expect(oversizedFrame.repository.saveConversationSnapshot).not.toHaveBeenCalled();
  });
});
