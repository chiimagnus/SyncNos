import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NATIVE_PORT_OPERATION_TIMEOUT_MS,
  readNativePortJson,
  writeNativePortFactsImport,
  type NativeMessagingPort,
} from '@platform/local-data/native-port';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  createHostFactsSuccess,
  parseHostFactsRequest,
} from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator } from '@services/local-data/digest';
import { createNativeWireDataFrame } from '@services/local-data/native-wire';

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
    listenerCounts() {
      return { message: messageListeners.size, disconnect: disconnectListeners.size };
    },
    port,
    postMessage,
  };
}

const digestProvider = {
  async sha256(bytes: Uint8Array) {
    return createHash('sha256').update(bytes).digest('hex');
  },
};

async function hostJsonFrames(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
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
  return {
    bytes,
    frames: [
      {
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        sessionId,
        sequence: 0,
        type: 'begin' as const,
        operation: 'host-json' as const,
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
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Native Messaging port EOF ordering', () => {
  it('drains already-delivered terminal frames before classifying a Host disconnect', async () => {
    const harness = createPortHarness();
    const request = parseHostFactsRequest({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      requestId: 'queued-terminal',
      command: 'CONVERSATION_BOOTSTRAP',
      payload: {},
    });
    const payload = { rows: [1, 2, 3] };
    const { bytes, frames } = await hostJsonFrames(payload);
    let releaseDigest!: () => void;
    const digestBlocked = new Promise<void>((resolve) => {
      releaseDigest = resolve;
    });
    let digestCalls = 0;
    const delayedDigestProvider = {
      async sha256(input: Uint8Array) {
        digestCalls += 1;
        if (digestCalls === 1) await digestBlocked;
        return createHash('sha256').update(input).digest('hex');
      },
    };

    const operation = readNativePortJson({
      port: harness.port,
      request,
      digestProvider: delayedDigestProvider,
    });
    harness.emitMessage(
      createHostFactsSuccess(request.requestId, {
        stream: { operation: 'host-json', declaredTotalBytes: bytes.byteLength },
      }),
    );
    for (const frame of frames) harness.emitMessage(frame);
    harness.emitDisconnect();

    let settled = false;
    void operation.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseDigest();
    await expect(operation).resolves.toEqual(payload);
    expect(harness.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
  });

  it('fails after queued frames drain when disconnect arrives without a terminal frame', async () => {
    const harness = createPortHarness();
    const request = parseHostFactsRequest({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      requestId: 'missing-terminal',
      command: 'CONVERSATION_BOOTSTRAP',
      payload: {},
    });
    const payload = { rows: [1] };
    const { bytes, frames } = await hostJsonFrames(payload);
    const operation = readNativePortJson({ port: harness.port, request, digestProvider });
    const rejected = expect(operation).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' });

    harness.emitMessage(
      createHostFactsSuccess(request.requestId, {
        stream: { operation: 'host-json', declaredTotalBytes: bytes.byteLength },
      }),
    );
    for (const frame of frames.slice(0, -1)) harness.emitMessage(frame);
    harness.emitDisconnect();

    await rejected;
    expect(harness.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
  });
});

describe('Native Messaging port operation deadline', () => {
  it('disconnects a connected Host that never starts a read response', async () => {
    vi.useFakeTimers();
    const harness = createPortHarness();
    const request = parseHostFactsRequest({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      requestId: 'silent-read',
      command: 'CONVERSATION_BOOTSTRAP',
      payload: {},
    });
    const operation = readNativePortJson({ port: harness.port, request });
    const rejected = expect(operation).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' });

    expect(harness.postMessage).toHaveBeenCalledWith(request);
    expect(harness.listenerCounts()).toEqual({ message: 1, disconnect: 1 });

    await vi.advanceTimersByTimeAsync(NATIVE_PORT_OPERATION_TIMEOUT_MS);
    await rejected;

    expect(harness.disconnect).toHaveBeenCalledOnce();
    expect(harness.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
  });

  it('aborts an accepted facts producer when the connected Host never returns a receipt', async () => {
    vi.useFakeTimers();
    const harness = createPortHarness();
    const migrationId = '11111111-1111-4111-8111-111111111111';
    const request = parseHostFactsRequest({
      protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      requestId: 'silent-import',
      command: 'IMPORT_FACTS',
      payload: {
        migrationId,
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      },
    });
    let observedSignal: AbortSignal | null = null;
    const produce = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      observedSignal = signal;
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      throw new Error('unreachable');
    });
    const operation = writeNativePortFactsImport({ port: harness.port, produce, request });
    const rejected = expect(operation).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' });

    harness.emitMessage(createHostFactsSuccess('silent-import', { accepted: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(produce).toHaveBeenCalledOnce();
    expect(observedSignal).not.toBeNull();

    await vi.advanceTimersByTimeAsync(NATIVE_PORT_OPERATION_TIMEOUT_MS);
    await rejected;

    expect(observedSignal!.aborted).toBe(true);
    expect(harness.disconnect).toHaveBeenCalledOnce();
    expect(harness.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
  });
});
