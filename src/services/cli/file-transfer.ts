import { IncrementalSha256 } from '@services/cli/sha256';

export class CliFileTransferError extends Error {
  code: string;
  extra: Record<string, unknown> | null;

  constructor(code: string, message: string, extra: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'CliFileTransferError';
    this.code = code;
    this.extra = extra;
  }
}

type FileTransferFrames = {
  fileBegin: string;
  fileChunk: string;
  fileAck: string;
  fileEnd: string;
  fileAbort: string;
};

type ReceiveResult = {
  blob: Blob;
  transferId: string;
  totalBytes: number;
  sha256: string;
  suggestedFilename: string;
  metadata: Record<string, unknown>;
};

type ReceiveState = {
  requestId: string;
  transferId: string;
  totalBytes: number;
  suggestedFilename: string;
  metadata: Record<string, unknown>;
  expectedSeq: number;
  receivedBytes: number;
  chunks: Uint8Array[];
  hasher: IncrementalSha256;
};

type ReceiveWaiter = {
  resolve: (value: ReceiveResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  state: ReceiveState | null;
};

type AckWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

function transferError(code: string, message: string, extra: Record<string, unknown> | null = null) {
  return new CliFileTransferError(code, message, extra);
}

function validTransferId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
}

function validSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function randomTransferId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `file_${uuid || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    const slice = bytes.subarray(offset, Math.min(offset + 0x8000, bytes.byteLength));
    binary += String.fromCharCode(...slice);
  }
  return globalThis.btoa(binary);
}

function base64ToBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) {
    throw transferError('file_chunk_invalid_base64', 'Invalid file chunk Base64');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw transferError('file_chunk_invalid_base64', 'Invalid file chunk Base64');
  }
  let binary: string;
  try {
    binary = globalThis.atob(value);
  } catch {
    throw transferError('file_chunk_invalid_base64', 'Invalid file chunk Base64');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function ackKey(requestId: string, transferId: string, seq: number): string {
  return `${requestId}\u0000${transferId}\u0000${seq}`;
}

export function createExtensionFileTransferController({
  frames,
  protocolVersion,
  chunkBytes,
  ackTimeoutMs,
  postFrame,
}: {
  frames: FileTransferFrames;
  protocolVersion: number;
  chunkBytes: number;
  ackTimeoutMs: number;
  postFrame: (frame: unknown) => void;
}) {
  const ackWaiters = new Map<string, AckWaiter>();
  const receiveWaiters = new Map<string, ReceiveWaiter>();
  const activeOutgoingRequests = new Set<string>();
  let closed = false;

  const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer) clearTimeout(timer);
  };

  const postAbort = (requestId: string, transferId: string, error: unknown) => {
    const code = String((error as any)?.code || 'file_transfer_failed');
    const message = String((error as any)?.message || error || 'File transfer failed');
    try {
      postFrame({
        kind: frames.fileAbort,
        protocolVersion,
        requestId,
        transferId,
        code,
        message,
      });
    } catch {
      // Transport failure is already represented by the original error.
    }
  };

  const waitForAck = (requestId: string, transferId: string, seq: number): Promise<void> => {
    if (closed) return Promise.reject(transferError('file_transfer_closed', 'File transfer transport is closed'));
    const key = ackKey(requestId, transferId, seq);
    if (ackWaiters.has(key)) return Promise.reject(transferError('file_transfer_state', 'Duplicate file ACK waiter'));
    return new Promise((resolve, reject) => {
      const waiter: AckWaiter = { resolve, reject, timer: null };
      if (Number.isFinite(ackTimeoutMs) && ackTimeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          if (ackWaiters.get(key) !== waiter) return;
          ackWaiters.delete(key);
          reject(transferError('file_transfer_timeout', 'Timed out waiting for file transfer ACK', { seq }));
        }, ackTimeoutMs);
      }
      ackWaiters.set(key, waiter);
    });
  };

  const postAndWaitAck = async (frame: Record<string, unknown>, seq: number) => {
    const requestId = String(frame.requestId || '');
    const transferId = String(frame.transferId || '');
    const pending = waitForAck(requestId, transferId, seq);
    try {
      postFrame(frame);
    } catch (error) {
      const key = ackKey(requestId, transferId, seq);
      const waiter = ackWaiters.get(key);
      if (waiter) {
        ackWaiters.delete(key);
        clearTimer(waiter.timer);
        waiter.reject(error instanceof Error ? error : new Error(String(error || 'File transfer send failed')));
      }
    }
    return await pending;
  };

  const sendBlob = async (
    requestId: string,
    input: { blob: Blob; suggestedFilename: string; metadata?: Record<string, unknown> },
  ) => {
    if (closed) throw transferError('file_transfer_closed', 'File transfer transport is closed');
    if (activeOutgoingRequests.has(requestId)) {
      throw transferError('file_transfer_active', 'A file transfer is already active for this request');
    }
    const blob = input.blob;
    if (!(blob instanceof Blob)) throw transferError('file_transfer_invalid_blob', 'Invalid export Blob');
    const transferId = randomTransferId();
    activeOutgoingRequests.add(requestId);
    const hasher = new IncrementalSha256();
    let seq = 0;
    try {
      await postAndWaitAck(
        {
          kind: frames.fileBegin,
          protocolVersion,
          requestId,
          transferId,
          direction: 'extension-to-host',
          totalBytes: blob.size,
          suggestedFilename: String(input.suggestedFilename || ''),
          metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
        },
        -1,
      );

      for (let offset = 0; offset < blob.size; offset += chunkBytes) {
        const bytes = new Uint8Array(await blob.slice(offset, Math.min(offset + chunkBytes, blob.size)).arrayBuffer());
        hasher.update(bytes);
        await postAndWaitAck(
          {
            kind: frames.fileChunk,
            protocolVersion,
            requestId,
            transferId,
            seq,
            data: bytesToBase64(bytes),
          },
          seq,
        );
        seq += 1;
      }

      const sha256 = hasher.digestHex();
      await postAndWaitAck(
        {
          kind: frames.fileEnd,
          protocolVersion,
          requestId,
          transferId,
          seq,
          totalBytes: blob.size,
          sha256,
        },
        seq,
      );
      return { transferId, byteSize: blob.size, sha256, suggestedFilename: String(input.suggestedFilename || '') };
    } catch (error) {
      postAbort(requestId, transferId, error);
      throw error;
    } finally {
      activeOutgoingRequests.delete(requestId);
    }
  };

  const rejectReceive = (requestId: string, error: Error, sendAbort = true) => {
    const waiter = receiveWaiters.get(requestId);
    if (!waiter) return;
    receiveWaiters.delete(requestId);
    clearTimer(waiter.timer);
    if (sendAbort && waiter.state) postAbort(requestId, waiter.state.transferId, error);
    waiter.reject(error);
  };

  const armReceiveTimeout = (requestId: string, waiter: ReceiveWaiter, message: string) => {
    clearTimer(waiter.timer);
    waiter.timer = null;
    if (!Number.isFinite(ackTimeoutMs) || ackTimeoutMs <= 0) return;
    waiter.timer = setTimeout(() => {
      if (receiveWaiters.get(requestId) !== waiter) return;
      rejectReceive(requestId, transferError('file_transfer_timeout', message));
    }, ackTimeoutMs);
  };

  const receiveBlob = (requestId: string): Promise<ReceiveResult> => {
    if (closed) return Promise.reject(transferError('file_transfer_closed', 'File transfer transport is closed'));
    if (receiveWaiters.has(requestId)) {
      return Promise.reject(
        transferError('file_transfer_active', 'A file transfer is already active for this request'),
      );
    }
    return new Promise((resolve, reject) => {
      const waiter: ReceiveWaiter = { resolve, reject, timer: null, state: null };
      receiveWaiters.set(requestId, waiter);
      armReceiveTimeout(requestId, waiter, 'Timed out waiting for file transfer start');
    });
  };

  const handleFrame = async (frame: any): Promise<boolean> => {
    if (!frame || typeof frame !== 'object') return false;
    const kind = frame.kind;
    if (![frames.fileBegin, frames.fileChunk, frames.fileAck, frames.fileEnd, frames.fileAbort].includes(kind)) {
      return false;
    }
    const requestId = String(frame.requestId || '');
    const transferId = String(frame.transferId || '');

    if (kind !== frames.fileAbort && Number(frame.protocolVersion) !== protocolVersion) {
      const error = transferError('protocol_mismatch', 'CLI protocol version mismatch');
      if (kind === frames.fileAck) {
        const seq = Number(frame.seq);
        if (Number.isInteger(seq)) {
          const key = ackKey(requestId, transferId, seq);
          const waiter = ackWaiters.get(key);
          if (waiter) {
            ackWaiters.delete(key);
            clearTimer(waiter.timer);
            waiter.reject(error);
          }
        }
        if (validTransferId(transferId)) postAbort(requestId, transferId, error);
        return true;
      }
      const receive = receiveWaiters.get(requestId);
      const hadActiveState = !!receive?.state;
      rejectReceive(requestId, error);
      if (!hadActiveState && validTransferId(transferId)) postAbort(requestId, transferId, error);
      return true;
    }

    if (kind === frames.fileAck) {
      const seq = Number(frame.seq);
      if (!Number.isInteger(seq)) return true;
      const key = ackKey(requestId, transferId, seq);
      const waiter = ackWaiters.get(key);
      if (!waiter) return true;
      ackWaiters.delete(key);
      clearTimer(waiter.timer);
      waiter.resolve();
      return true;
    }

    if (kind === frames.fileAbort) {
      const error = transferError(
        String(frame.code || 'file_transfer_aborted'),
        String(frame.message || 'File transfer aborted by peer'),
      );
      for (const [key, waiter] of ackWaiters.entries()) {
        if (!key.startsWith(`${requestId}\u0000${transferId}\u0000`)) continue;
        ackWaiters.delete(key);
        clearTimer(waiter.timer);
        waiter.reject(error);
      }
      rejectReceive(requestId, error, false);
      return true;
    }

    const receive = receiveWaiters.get(requestId);
    if (!receive) {
      if (validTransferId(transferId))
        postAbort(requestId, transferId, transferError('file_transfer_unexpected', 'Unexpected file transfer'));
      return true;
    }

    try {
      if (kind === frames.fileBegin) {
        if (receive.state) throw transferError('file_transfer_state', 'Duplicate file-begin frame');
        if (frame.direction !== 'host-to-extension')
          throw transferError('file_transfer_direction', 'Invalid file transfer direction');
        if (!validTransferId(transferId)) throw transferError('file_transfer_id_invalid', 'Invalid transfer id');
        const totalBytes = Number(frame.totalBytes);
        if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
          throw transferError('file_transfer_size_invalid', 'Invalid file transfer size');
        }
        receive.state = {
          requestId,
          transferId,
          totalBytes,
          suggestedFilename: String(frame.suggestedFilename || ''),
          metadata: frame.metadata && typeof frame.metadata === 'object' ? frame.metadata : {},
          expectedSeq: 0,
          receivedBytes: 0,
          chunks: [],
          hasher: new IncrementalSha256(),
        };
        armReceiveTimeout(requestId, receive, 'Timed out waiting for the next file frame');
        postFrame({ kind: frames.fileAck, protocolVersion, requestId, transferId, seq: -1 });
        return true;
      }

      const state = receive.state;
      if (!state || state.transferId !== transferId)
        throw transferError('file_transfer_state', 'File transfer is not active');

      if (kind === frames.fileChunk) {
        const seq = Number(frame.seq);
        if (!Number.isInteger(seq) || seq !== state.expectedSeq) {
          throw transferError('file_transfer_sequence', 'Unexpected file chunk sequence', {
            expectedSeq: state.expectedSeq,
            receivedSeq: Number.isInteger(seq) ? seq : null,
          });
        }
        const bytes = base64ToBytes(frame.data);
        if (bytes.byteLength > chunkBytes || state.receivedBytes + bytes.byteLength > state.totalBytes) {
          throw transferError('file_transfer_size_mismatch', 'File chunk exceeds declared transfer size');
        }
        state.chunks.push(bytes);
        state.hasher.update(bytes);
        state.receivedBytes += bytes.byteLength;
        state.expectedSeq += 1;
        armReceiveTimeout(requestId, receive, 'Timed out waiting for the next file frame');
        postFrame({ kind: frames.fileAck, protocolVersion, requestId, transferId, seq });
        return true;
      }

      const endSeq = Number(frame.seq);
      if (!Number.isInteger(endSeq) || endSeq !== state.expectedSeq) {
        throw transferError('file_transfer_sequence', 'Unexpected file end sequence');
      }
      if (state.receivedBytes !== state.totalBytes || Number(frame.totalBytes) !== state.totalBytes) {
        throw transferError('file_transfer_size_mismatch', 'File transfer byte count mismatch');
      }
      const actualSha256 = state.hasher.digestHex();
      const expectedSha256 = String(frame.sha256 || '').toLowerCase();
      if (!validSha256(expectedSha256) || actualSha256 !== expectedSha256) {
        throw transferError('file_transfer_hash_mismatch', 'File transfer SHA-256 mismatch');
      }
      const blob = new Blob(state.chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer));
      postFrame({ kind: frames.fileAck, protocolVersion, requestId, transferId, seq: endSeq });
      receiveWaiters.delete(requestId);
      clearTimer(receive.timer);
      receive.resolve({
        blob,
        transferId,
        totalBytes: state.totalBytes,
        sha256: actualSha256,
        suggestedFilename: state.suggestedFilename,
        metadata: state.metadata,
      });
      return true;
    } catch (error) {
      const normalized =
        error instanceof Error ? error : transferError('file_transfer_failed', String(error || 'File transfer failed'));
      rejectReceive(requestId, normalized);
      return true;
    }
  };

  const abortAll = (error: Error = transferError('file_transfer_closed', 'File transfer transport is closed')) => {
    if (closed) return;
    closed = true;
    for (const [key, waiter] of ackWaiters.entries()) {
      ackWaiters.delete(key);
      clearTimer(waiter.timer);
      waiter.reject(error);
    }
    for (const [requestId, waiter] of receiveWaiters.entries()) {
      receiveWaiters.delete(requestId);
      clearTimer(waiter.timer);
      waiter.reject(error);
    }
    activeOutgoingRequests.clear();
  };

  return { sendBlob, receiveBlob, handleFrame, abortAll };
}
