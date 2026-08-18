import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseRuntimeStreamMessage, RuntimeStreamReceiver, RuntimeStreamSender } from '@platform/messaging/stream-port';
import { connectPort } from '@platform/runtime/ports';
import { MAX_ZIP_STREAM_BYTES } from '@services/local-data/contracts';
import { exportBackupZip, importBackupFile } from '@services/sync/backup/client';
import { createEmptyImportStats } from '@services/sync/backup/local-data';

vi.mock('@platform/runtime/ports', () => ({ connectPort: vi.fn() }));

type Listener = (message?: unknown) => void;

function runtimePortHarness(onClientMessage: (message: unknown, emit: (message: unknown) => void) => void) {
  const messageListeners = new Set<Listener>();
  const disconnectListeners = new Set<Listener>();
  let disconnected = false;
  const emit = (message: unknown) => {
    if (disconnected) return;
    for (const listener of messageListeners) listener(message);
  };
  return {
    disconnectFromRemote() {
      if (disconnected) return;
      disconnected = true;
      for (const listener of disconnectListeners) listener();
    },
    port: {
      postMessage(message: unknown) {
        if (disconnected) throw new Error('disconnected');
        onClientMessage(message, emit);
      },
      disconnect() {
        if (disconnected) return;
        disconnected = true;
      },
      onMessage: {
        addListener(listener: Listener) {
          messageListeners.add(listener);
        },
        removeListener(listener: Listener) {
          messageListeners.delete(listener);
        },
      },
      onDisconnect: {
        addListener(listener: Listener) {
          disconnectListeners.add(listener);
        },
        removeListener(listener: Listener) {
          disconnectListeners.delete(listener);
        },
      },
    },
    get disconnected() {
      return disconnected;
    },
  };
}

afterEach(() => {
  vi.mocked(connectPort).mockReset();
});

describe('backup runtime-stream client', () => {
  it('downloads ZIP bytes through the announced zip-backup header and ACK flow', async () => {
    const expected = new TextEncoder().encode('PK\u0003\u0004portable-backup');
    let sender: RuntimeStreamSender | null = null;
    let disconnectFromRemote: (() => void) | null = null;
    const clientMessages: unknown[] = [];
    const harness = runtimePortHarness((message, emit) => {
      clientMessages.push(message);
      const parsed = parseRuntimeStreamMessage(message);
      if (parsed.type === 'open') {
        expect(parsed).toMatchObject({ direction: 'download', operation: 'zip-backup' });
        sender = new RuntimeStreamSender({
          announceHeader: true,
          port: {
            postMessage(value) {
              emit(value);
              const outgoing = parseRuntimeStreamMessage(value);
              if (outgoing.type === 'frame' && (outgoing.frame as { type?: unknown }).type === 'terminal') {
                disconnectFromRemote?.();
              }
            },
          },
          requestId: parsed.requestId,
        });
        void sender.send(expected, { operation: 'zip-backup', declaredTotalBytes: expected.byteLength });
        return;
      }
      if (parsed.type === 'ack') sender?.accept(parsed);
    });
    disconnectFromRemote = harness.disconnectFromRemote;
    vi.mocked(connectPort).mockReturnValue(harness.port as any);

    const result = await exportBackupZip();
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(expected);
    expect(result.filename).toMatch(/^SyncNos-Backup-.*\.zip$/);
    expect(clientMessages.some((message) => (message as any)?.type === 'ack')).toBe(true);
    expect(harness.disconnected).toBe(true);
  });

  it('uploads one bounded backup stream and resolves only from typed background completion stats', async () => {
    const expected = new TextEncoder().encode(
      '{"schemaVersion":1,"stores":{"conversations":[],"messages":[],"sync_mappings":[]}}',
    );
    const stats = { ...createEmptyImportStats(), settingsApplied: 2 };
    let receiver: RuntimeStreamReceiver | null = null;
    let disconnectFromRemote: (() => void) | null = null;
    let queue = Promise.resolve();
    const harness = runtimePortHarness((message, emit) => {
      queue = queue.then(async () => {
        const parsed = parseRuntimeStreamMessage(message);
        if (parsed.type === 'open') {
          expect(parsed).toMatchObject({ direction: 'upload', stream: { operation: 'zip-backup' } });
          receiver = new RuntimeStreamReceiver(parsed.requestId, parsed.stream);
          return;
        }
        if (parsed.type !== 'frame' || !receiver) return;
        const event = await receiver.accept(parsed);
        if (event?.kind === 'ack') {
          emit({ type: 'ack', requestId: parsed.requestId, acknowledgedSequence: event.acknowledgedSequence });
          return;
        }
        if (event?.kind === 'complete') {
          expect(event.bytes).toEqual(expected);
          emit({ type: 'complete', requestId: parsed.requestId, data: stats });
          disconnectFromRemote?.();
        }
      });
    });
    disconnectFromRemote = harness.disconnectFromRemote;
    vi.mocked(connectPort).mockReturnValue(harness.port as any);

    await expect(importBackupFile(new Blob([expected]))).resolves.toEqual(stats);
    await queue;
    expect(harness.disconnected).toBe(true);
  });

  it('rejects an oversized backup before allocating bytes or opening a Runtime Port', async () => {
    class OversizedBlob extends Blob {
      override get size(): number {
        return MAX_ZIP_STREAM_BYTES + 1;
      }
      override async arrayBuffer(): Promise<ArrayBuffer> {
        throw new Error('arrayBuffer must not be called');
      }
    }

    await expect(importBackupFile(new OversizedBlob())).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(connectPort).not.toHaveBeenCalled();
  });
});
