import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { connectNative, sendNativeMessage } from '@platform/local-data/native-client';
import type { NativeMessagingPort } from '@platform/local-data/native-port';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  MAX_ORDINARY_CAPTURE_SNAPSHOT_BYTES,
  createHostFactsFailure,
  createHostFactsSuccess,
} from '@services/local-data/contracts';
import { OrderedFrameDigestAccumulator } from '@services/local-data/digest';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
import { nativeHostContract } from '@services/local-data/native-host-contract';
import { createNativeWireDataFrame } from '@services/local-data/native-wire';

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
