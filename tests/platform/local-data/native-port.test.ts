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

afterEach(() => {
  vi.useRealTimers();
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
