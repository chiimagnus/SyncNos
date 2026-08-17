import { LOCAL_DATA_STREAM_MESSAGE_TYPES, UI_PORT_NAMES } from '@platform/messaging/message-contracts';
import {
  RuntimeStreamReceiver,
  RuntimeStreamSender,
  parseRuntimeStreamMessage,
  type RuntimeStreamPort,
} from '@platform/messaging/stream-port';
import { connectPort } from '@platform/runtime/ports';
import {
  LocalDataContractError,
  MAX_ZIP_STREAM_BYTES,
  parseStreamDescriptor,
  type StreamDescriptor,
} from '@services/local-data/contracts';
import { buildLocalTimestampForFilename } from '@services/shared/file-timestamp';
import { backupBytesForBlob, parseImportStats, type ImportStats } from '@services/sync/backup/local-data';

export type { ImportStats } from '@services/sync/backup/local-data';

type RuntimePortListener = (message?: unknown) => void;
type BackupStreamPort = RuntimeStreamPort &
  Readonly<{
    onDisconnect?: Readonly<{
      addListener?: (listener: RuntimePortListener) => void;
      removeListener?: (listener: RuntimePortListener) => void;
    }>;
    onMessage?: Readonly<{
      addListener?: (listener: RuntimePortListener) => void;
      removeListener?: (listener: RuntimePortListener) => void;
    }>;
  }>;

const BACKUP_STREAM_TIMEOUT_MS = 10 * 60_000;

function protocolFailure(): never {
  throw new LocalDataContractError('PROTOCOL_MISMATCH');
}

function requestId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (typeof value !== 'string') throw new LocalDataContractError('HOST_UNAVAILABLE');
  return value;
}

function asBackupStreamPort(value: unknown): BackupStreamPort {
  if (!value || typeof value !== 'object') protocolFailure();
  const port = value as BackupStreamPort;
  if (
    typeof port.postMessage !== 'function' ||
    typeof port.onMessage?.addListener !== 'function' ||
    typeof port.onDisconnect?.addListener !== 'function'
  ) {
    protocolFailure();
  }
  return port;
}

function disconnect(port: BackupStreamPort): void {
  try {
    port.disconnect?.();
  } catch {
    // A Runtime Port is one-shot for backup transfer.
  }
}

export type BackupExportDownload = Readonly<{
  blob: Blob;
  filename: string;
}>;

/** Downloads one complete user ZIP from the background-owned gate. */
export async function exportBackupZip(): Promise<BackupExportDownload> {
  const id = requestId();
  const port = asBackupStreamPort(connectPort(UI_PORT_NAMES.LOCAL_DATA_STREAM));
  return await new Promise<BackupExportDownload>((resolve, reject) => {
    let closed = false;
    let receiver: RuntimeStreamReceiver | null = null;
    let stream: StreamDescriptor | null = null;
    let queue = Promise.resolve();
    const timeout = globalThis.setTimeout(
      () => fail(new LocalDataContractError('HOST_UNAVAILABLE')),
      BACKUP_STREAM_TIMEOUT_MS,
    );

    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      receiver?.dispose();
      port.onMessage?.removeListener?.(onMessage);
      port.onDisconnect?.removeListener?.(onDisconnect);
      disconnect(port);
    };
    const fail = (error: unknown) => {
      if (closed) return;
      closed = true;
      cleanup();
      reject(error);
    };
    const complete = (bytes: Uint8Array) => {
      if (closed) return;
      closed = true;
      cleanup();
      resolve({
        blob: new Blob([backupBytesForBlob(bytes)], { type: 'application/zip' }),
        filename: `SyncNos-Backup-${buildLocalTimestampForFilename()}.zip`,
      });
    };
    const accept = async (raw: unknown) => {
      const message = parseRuntimeStreamMessage(raw);
      if (message.requestId !== id) protocolFailure();
      if (message.type === 'error') throw new LocalDataContractError(message.error.code, message.error.diagnostics);
      if (message.type === 'header') {
        if (receiver || stream) protocolFailure();
        stream = parseStreamDescriptor(message.stream, ['zip-backup']);
        if (stream.declaredTotalBytes <= 0 || stream.declaredTotalBytes > MAX_ZIP_STREAM_BYTES) protocolFailure();
        receiver = new RuntimeStreamReceiver(id, stream);
        return;
      }
      if (!receiver || !stream || message.type !== 'frame') protocolFailure();
      const event = await receiver.accept(message);
      if (event?.kind === 'ack') {
        port.postMessage({
          type: LOCAL_DATA_STREAM_MESSAGE_TYPES.ACK,
          requestId: id,
          acknowledgedSequence: event.acknowledgedSequence,
        });
        return;
      }
      if (event?.kind === 'complete') {
        complete(event.bytes);
        return;
      }
      if (event?.kind === 'cancelled' || event?.kind === 'failed') {
        throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
      }
    };
    const onMessage: RuntimePortListener = (raw) => {
      queue = queue.then(() => accept(raw)).catch(fail);
    };
    const onDisconnect: RuntimePortListener = () => {
      if (!closed) fail(new LocalDataContractError('HOST_UNAVAILABLE'));
    };

    try {
      port.onMessage?.addListener?.(onMessage);
      port.onDisconnect?.addListener?.(onDisconnect);
      port.postMessage({
        type: LOCAL_DATA_STREAM_MESSAGE_TYPES.OPEN,
        requestId: id,
        direction: 'download',
        operation: 'zip-backup',
      });
    } catch (error) {
      fail(error);
    }
  });
}

/** Uploads bytes only after the file size is proven within the shared ZIP stream limit. */
export async function importBackupFile(file: Blob): Promise<ImportStats> {
  if (!(file instanceof Blob) || file.size <= 0) throw new LocalDataContractError('INVALID_ARGUMENT');
  const stream = parseStreamDescriptor({ operation: 'zip-backup', declaredTotalBytes: file.size }, ['zip-backup']);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== stream.declaredTotalBytes) protocolFailure();

  const id = requestId();
  const port = asBackupStreamPort(connectPort(UI_PORT_NAMES.LOCAL_DATA_STREAM));
  const sender = new RuntimeStreamSender({ announceHeader: false, port, requestId: id });
  return await new Promise<ImportStats>((resolve, reject) => {
    let closed = false;
    let queue = Promise.resolve();
    const timeout = globalThis.setTimeout(
      () => fail(new LocalDataContractError('HOST_UNAVAILABLE')),
      BACKUP_STREAM_TIMEOUT_MS,
    );

    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      sender.dispose();
      port.onMessage?.removeListener?.(onMessage);
      port.onDisconnect?.removeListener?.(onDisconnect);
      disconnect(port);
    };
    const fail = (error: unknown) => {
      if (closed) return;
      closed = true;
      cleanup();
      reject(error);
    };
    const complete = (stats: ImportStats) => {
      if (closed) return;
      closed = true;
      cleanup();
      resolve(stats);
    };
    const accept = (raw: unknown) => {
      const message = parseRuntimeStreamMessage(raw);
      if (message.requestId !== id) protocolFailure();
      if (message.type === 'complete') {
        if (message.data === undefined) protocolFailure();
        complete(parseImportStats(message.data));
        return;
      }
      if (message.type === 'error') throw new LocalDataContractError(message.error.code, message.error.diagnostics);
      sender.accept(message);
    };
    const onMessage: RuntimePortListener = (raw) => {
      queue = queue.then(() => accept(raw)).catch(fail);
    };
    const onDisconnect: RuntimePortListener = () => {
      if (!closed) fail(new LocalDataContractError('HOST_UNAVAILABLE'));
    };

    try {
      port.onMessage?.addListener?.(onMessage);
      port.onDisconnect?.addListener?.(onDisconnect);
      port.postMessage({
        type: LOCAL_DATA_STREAM_MESSAGE_TYPES.OPEN,
        requestId: id,
        direction: 'upload',
        stream,
      });
      void sender.send(bytes, stream).catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}
