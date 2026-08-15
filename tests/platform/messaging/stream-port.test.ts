import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  RuntimeStreamReceiver,
  RuntimeStreamSender,
  parseRuntimeStreamMessage,
  type RuntimeStreamFrameMessage,
} from '@platform/messaging/stream-port';
import { BackgroundStreamRouter } from '@services/local-data/background-stream-router';
import { LOCAL_DATA_PROTOCOL_VERSION } from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator } from '@services/local-data/digest';
import { FactsOperationGate, assertFactsOperationLease } from '@services/local-data/facts-operation-gate';
import { createNativeWireDataFrame } from '@services/local-data/native-wire';
import type { MigrationJournalSnapshot } from '@platform/local-data/migration-journal';

const digestProvider = {
  async sha256(bytes: Uint8Array) {
    return createHash('sha256').update(bytes).digest('hex');
  },
};

async function wireFrames(bytes: Uint8Array, operation: 'capture-snapshot' | 'host-json' = 'capture-snapshot') {
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
      operation,
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

function frame(requestId: string, value: unknown): RuntimeStreamFrameMessage {
  return parseRuntimeStreamMessage({ type: 'frame', requestId, frame: value }) as RuntimeStreamFrameMessage;
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
        if (disconnected) throw new Error('port is disconnected');
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
    listenerCounts() {
      return { message: messageListeners.size, disconnect: disconnectListeners.size };
    },
    posted,
  };
}

const notStarted = {
  mode: 'not_started',
  journal: null,
  factsEpoch: 'idb-v1',
  error: null,
} as const satisfies MigrationJournalSnapshot;

describe('local data stream port protocol', () => {
  it('acknowledges bounded P1 data frames and exposes bytes only after end plus terminal', async () => {
    const requestId = 'capture-request';
    const bytes = new TextEncoder().encode('{"title":"capture"}');
    const receiver = new RuntimeStreamReceiver(
      requestId,
      { operation: 'capture-snapshot', declaredTotalBytes: bytes.byteLength },
      digestProvider,
    );
    const frames = await wireFrames(bytes);

    await expect(receiver.accept(frame(requestId, frames[0]))).resolves.toBeNull();
    await expect(receiver.accept(frame(requestId, frames[1]))).resolves.toEqual({
      kind: 'ack',
      acknowledgedSequence: 1,
    });
    await expect(receiver.accept(frame(requestId, frames[2]))).resolves.toBeNull();
    await expect(receiver.accept(frame(requestId, frames[3]))).resolves.toEqual({ kind: 'complete', bytes });
  });

  it('rejects oversized declarations and runtime envelopes before a receiver can retain bytes', () => {
    let oversizedDeclarationError: unknown;
    try {
      parseRuntimeStreamMessage({
        type: 'open',
        requestId: 'too-large',
        direction: 'upload',
        stream: { operation: 'capture-snapshot', declaredTotalBytes: 64 * 1024 * 1024 + 1 },
      });
    } catch (error) {
      oversizedDeclarationError = error;
    }
    expect(oversizedDeclarationError).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });

    let oversizedFrameError: unknown;
    try {
      parseRuntimeStreamMessage({
        type: 'frame',
        requestId: 'too-large-frame',
        frame: { data: 'x'.repeat(512 * 1024) },
      });
    } catch (error) {
      oversizedFrameError = error;
    }
    expect(oversizedFrameError).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('clears an incomplete stream on cancel without exposing a partial payload', async () => {
    const requestId = 'cancel-request';
    const receiver = new RuntimeStreamReceiver(requestId, {
      operation: 'capture-snapshot',
      declaredTotalBytes: 0,
    });
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    await receiver.accept(
      frame(requestId, {
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        sessionId,
        sequence: 0,
        type: 'begin',
        operation: 'capture-snapshot',
        declaredTotalBytes: 0,
      }),
    );

    await expect(
      receiver.accept(
        frame(requestId, {
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          sessionId,
          sequence: 1,
          type: 'cancel',
          reason: 'cancelled',
        }),
      ),
    ).resolves.toEqual({ kind: 'cancelled' });
    await expect(
      receiver.accept(
        frame(requestId, {
          protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
          sessionId,
          sequence: 2,
          type: 'terminal',
          status: 'cancelled',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PROTOCOL_MISMATCH' });
  });

  it('waits for each ack before posting the next sender frame', async () => {
    const posted: unknown[] = [];
    const port = {
      postMessage(message: unknown) {
        posted.push(message);
      },
    };
    const sender = new RuntimeStreamSender({
      announceHeader: true,
      createSessionId: () => '550e8400-e29b-41d4-a716-446655440000',
      digestProvider,
      port,
      requestId: 'download-request',
    });
    const send = sender.send(new TextEncoder().encode('payload'), {
      operation: 'host-json',
      declaredTotalBytes: 7,
    });
    await vi.waitFor(() => expect(posted.map((message: any) => message.type)).toEqual(['header', 'frame', 'frame']));
    const dataFrame = (posted[2] as any).frame;
    sender.accept(
      parseRuntimeStreamMessage({
        type: 'ack',
        requestId: 'download-request',
        acknowledgedSequence: dataFrame.sequence,
      }),
    );

    await expect(send).resolves.toBeUndefined();
    expect(posted.map((message: any) => message.type)).toEqual(['header', 'frame', 'frame', 'frame', 'frame']);
    expect((posted.at(-1) as any).frame).toMatchObject({ type: 'terminal', status: 'ok' });
  });
});

describe('background local-data stream router', () => {
  it('does not call a facts handler until a fully verified upload terminal arrives', async () => {
    const gate = new FactsOperationGate({ readJournal: async () => notStarted });
    await gate.initializeFromJournal();
    const router = new BackgroundStreamRouter(gate);
    const bytes = new TextEncoder().encode('{"title":"capture"}');
    const handler = vi.fn(async ({ bytes: uploaded, lease }: any) => {
      assertFactsOperationLease(lease);
      expect(uploaded).toEqual(bytes);
    });
    router.register('capture-snapshot', { upload: handler });
    const stream = createStreamPort();
    expect(router.registerPort(stream.port)).toBe(true);

    stream.emit({
      type: 'open',
      requestId: 'capture-upload',
      direction: 'upload',
      stream: { operation: 'capture-snapshot', declaredTotalBytes: bytes.byteLength },
    });
    for (const wireFrame of await wireFrames(bytes)) {
      stream.emit({ type: 'frame', requestId: 'capture-upload', frame: wireFrame });
    }

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(stream.posted).toContainEqual({ type: 'complete', requestId: 'capture-upload' }));
    expect(stream.posted).toContainEqual({ type: 'ack', requestId: 'capture-upload', acknowledgedSequence: 1 });
  });

  it('cleans up oversized and disconnected uploads before any facts handler can run', async () => {
    const gate = new FactsOperationGate({ readJournal: async () => notStarted });
    await gate.initializeFromJournal();
    const router = new BackgroundStreamRouter(gate);
    const handler = vi.fn(async () => {});
    router.register('capture-snapshot', { upload: handler });

    const oversized = createStreamPort();
    router.registerPort(oversized.port);
    oversized.emit({
      type: 'open',
      requestId: 'oversized-upload',
      direction: 'upload',
      stream: { operation: 'capture-snapshot', declaredTotalBytes: 64 * 1024 * 1024 + 1 },
    });
    await vi.waitFor(() =>
      expect(oversized.posted).toContainEqual(
        expect.objectContaining({
          type: 'error',
          requestId: 'oversized-upload',
          error: expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }),
        }),
      ),
    );

    const incomplete = createStreamPort();
    router.registerPort(incomplete.port);
    incomplete.emit({
      type: 'open',
      requestId: 'incomplete-upload',
      direction: 'upload',
      stream: { operation: 'capture-snapshot', declaredTotalBytes: 1 },
    });
    incomplete.disconnect();
    await gate.waitForDrained();

    expect(handler).not.toHaveBeenCalled();
    expect(incomplete.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
  });
});
