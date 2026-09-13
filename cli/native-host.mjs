#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { endianness } from 'node:os';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { TextDecoder } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { contract } from './contract.mjs';
import { createOutputFileReceiver, decodeBase64Chunk, openInputFile, readInputFileChunks } from './file-transfer.mjs';
import { createJsonLineReader, encodeJsonLine, requestEndpoint } from './ipc.mjs';
import {
  createProcessNonce,
  ensureRuntimeDir,
  readRegistryEntry,
  registryPathForInstance,
  removeFileIfExists,
  removeRegistryEntryIfOwned,
  socketPathForInstance,
  writeRegistryEntry,
} from './runtime-registry.mjs';

export { contract } from './contract.mjs';
const LITTLE_ENDIAN = endianness() === 'LE';

function readLength(buffer, offset = 0) {
  return LITTLE_ENDIAN ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function writeLength(buffer, value, offset = 0) {
  if (LITTLE_ENDIAN) buffer.writeUInt32LE(value, offset);
  else buffer.writeUInt32BE(value, offset);
}

export function encodeNativeMessage(value, maxBytes = contract.nativeMessaging.hostToExtensionMaxBytes) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length <= 0) throw new Error('native_message_empty');
  if (body.length > maxBytes) throw new Error('native_message_too_large');
  const frame = Buffer.allocUnsafe(4 + body.length);
  writeLength(frame, body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export class NativeMessageParser {
  constructor(maxBytes = contract.nativeMessaging.extensionToHostMaxBytes) {
    this.maxBytes = maxBytes;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, next]) : next;
    const messages = [];
    while (this.buffer.length >= 4) {
      const length = readLength(this.buffer, 0);
      if (length <= 0) throw new Error('native_message_empty');
      if (length > this.maxBytes) throw new Error('native_message_too_large');
      if (this.buffer.length < 4 + length) break;
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(body);
      } catch {
        throw new Error('native_message_invalid_utf8');
      }
      try {
        messages.push(JSON.parse(text));
      } catch {
        throw new Error('native_message_invalid_json');
      }
    }
    return messages;
  }

  finish() {
    if (this.buffer.length !== 0) throw new Error('native_message_truncated');
  }
}

export function writeNativeMessage(stream, value) {
  const frame = encodeNativeMessage(value);
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      stream.off?.('error', onError);
      stream.off?.('drain', onDrain);
    };
    stream.once?.('error', onError);
    try {
      const accepted = stream.write(frame);
      if (accepted !== false) {
        cleanup();
        resolve();
        return;
      }
      stream.once?.('drain', onDrain);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function createNativeHostProtocol({
  write = (frame) => writeNativeMessage(process.stdout, frame),
  onHello = async () => {},
  onClose = () => {},
  requestTimeoutMs = 60_000,
} = {}) {
  let closed = false;
  let helloAccepted = false;
  const pending = new Map();
  const ackWaiters = new Map();
  const exportTransfers = new Map();

  const makeError = (code, message, extra = null) => {
    const error = new Error(message || code);
    error.code = code;
    error.extra = extra;
    return error;
  };

  const cleanupWaiter = (waiter) => {
    if (!waiter) return;
    if (waiter.timer) clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener?.('abort', waiter.onAbort);
  };

  const ackKey = (requestId, transferId, seq) => `${requestId}\u0000${transferId}\u0000${seq}`;

  const rejectPendingRequest = (requestId, error) => {
    const waiter = pending.get(requestId);
    if (!waiter) return;
    pending.delete(requestId);
    cleanupWaiter(waiter);
    waiter.reject(error);
  };

  const settleExportTransfer = async (requestId, { error = null, value = null } = {}) => {
    const state = exportTransfers.get(requestId);
    if (!state) return;
    exportTransfers.delete(requestId);
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (error) {
      await state.receiver.abort().catch(() => {});
      state.reject(error);
    } else {
      state.resolve(value);
    }
  };

  const close = (error = new Error('native_host_closed')) => {
    if (closed) return;
    closed = true;
    for (const waiter of pending.values()) {
      cleanupWaiter(waiter);
      waiter.reject(error);
    }
    pending.clear();
    for (const waiter of ackWaiters.values()) {
      cleanupWaiter(waiter);
      waiter.reject(error);
    }
    ackWaiters.clear();
    for (const [requestId, state] of exportTransfers.entries()) {
      exportTransfers.delete(requestId);
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      void state.receiver.abort().catch(() => {});
      state.reject(error);
    }
    try {
      void onClose(error);
    } catch {
      // ignore cleanup callback failures
    }
  };

  const registerRequest = (requestId, options = {}) => {
    let resolveResponse;
    let rejectResponse;
    const responsePromise = new Promise((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const timeout = Number(options.timeoutMs ?? requestTimeoutMs);
    const signal = options.signal ?? null;
    const waiter = {
      resolve: resolveResponse,
      reject: rejectResponse,
      timer: null,
      signal,
      onAbort: null,
    };
    if (Number.isFinite(timeout) && timeout > 0) {
      waiter.timer = setTimeout(() => {
        const current = pending.get(requestId);
        if (!current) return;
        pending.delete(requestId);
        cleanupWaiter(current);
        current.reject(makeError('native_host_request_timeout', 'Native Messaging RPC timed out'));
      }, timeout);
    }
    if (signal) {
      waiter.onAbort = () => {
        const current = pending.get(requestId);
        if (!current) return;
        pending.delete(requestId);
        cleanupWaiter(current);
        const reason =
          signal.reason instanceof Error
            ? signal.reason
            : makeError('native_host_request_cancelled', 'Native Messaging RPC cancelled');
        if (!reason.code) reason.code = 'native_host_request_cancelled';
        current.reject(reason);
      };
    }
    pending.set(requestId, waiter);
    signal?.addEventListener?.('abort', waiter.onAbort, { once: true });
    if (signal?.aborted) waiter.onAbort();
    return responsePromise;
  };

  const beginRequest = async (method, params = {}, options = {}, requestId = `rpc_${randomUUID()}`) => {
    if (closed) throw makeError('native_host_closed', 'Native host is closed');
    if (!helloAccepted) throw makeError('native_host_not_ready', 'Native host is not ready');
    const responsePromise = registerRequest(requestId, options);
    if (!pending.has(requestId)) return { requestId, responsePromise };
    try {
      await write({
        kind: contract.frames.rpcRequest,
        protocolVersion: contract.protocolVersion,
        requestId,
        method,
        params,
      });
    } catch (error) {
      rejectPendingRequest(
        requestId,
        error instanceof Error ? error : new Error(String(error || 'Native Messaging write failed')),
      );
      throw error;
    }
    return { requestId, responsePromise };
  };

  const waitForFileAck = (requestId, transferId, seq, { signal = null } = {}) => {
    if (closed) return Promise.reject(makeError('native_host_closed', 'Native host is closed'));
    const key = ackKey(requestId, transferId, seq);
    if (ackWaiters.has(key)) return Promise.reject(makeError('file_transfer_state', 'Duplicate file ACK waiter'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null, signal, onAbort: null };
      const timeout = Number(contract.fileTransfer.ackTimeoutMs);
      if (Number.isFinite(timeout) && timeout > 0) {
        waiter.timer = setTimeout(() => {
          if (ackWaiters.get(key) !== waiter) return;
          ackWaiters.delete(key);
          cleanupWaiter(waiter);
          reject(makeError('file_transfer_timeout', 'Timed out waiting for file transfer ACK', { seq }));
        }, timeout);
      }
      if (signal) {
        waiter.onAbort = () => {
          if (ackWaiters.get(key) !== waiter) return;
          ackWaiters.delete(key);
          cleanupWaiter(waiter);
          const reason =
            signal.reason instanceof Error
              ? signal.reason
              : makeError('native_host_request_cancelled', 'File transfer cancelled');
          reject(reason);
        };
        signal.addEventListener?.('abort', waiter.onAbort, { once: true });
      }
      ackWaiters.set(key, waiter);
      if (signal?.aborted) waiter.onAbort();
    });
  };

  const writeAndWaitFileAck = async (frame, seq, options = {}) => {
    const pendingAck = waitForFileAck(String(frame.requestId || ''), String(frame.transferId || ''), seq, options);
    try {
      await write(frame);
    } catch (error) {
      const key = ackKey(String(frame.requestId || ''), String(frame.transferId || ''), seq);
      const waiter = ackWaiters.get(key);
      if (waiter) {
        ackWaiters.delete(key);
        cleanupWaiter(waiter);
        waiter.reject(error);
      }
    }
    return await pendingAck;
  };

  const sendFileAbort = async (requestId, transferId, error) => {
    if (!transferId) return;
    await write({
      kind: contract.frames.fileAbort,
      protocolVersion: contract.protocolVersion,
      requestId,
      transferId,
      code: String(error?.code || 'file_transfer_failed'),
      message: String(error?.message || error || 'File transfer failed'),
    }).catch(() => {});
  };

  const failExportTransfer = async (requestId, error, { notifyPeer = true } = {}) => {
    const state = exportTransfers.get(requestId);
    if (!state) return;
    if (notifyPeer) await sendFileAbort(requestId, state.transferId, error);
    await settleExportTransfer(requestId, { error });
  };

  const armExportIdleTimeout = (requestId, state) => {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    const timeout = Number(contract.fileTransfer.ackTimeoutMs);
    if (!Number.isFinite(timeout) || timeout <= 0) return;
    state.timer = setTimeout(() => {
      if (exportTransfers.get(requestId) !== state) return;
      void failExportTransfer(
        requestId,
        makeError('file_transfer_timeout', 'Timed out waiting for the next file frame'),
      );
    }, timeout);
  };

  const handleExportFileFrame = async (message) => {
    const requestId = String(message.requestId || '');
    const state = exportTransfers.get(requestId);
    if (!state) {
      await sendFileAbort(
        requestId,
        String(message.transferId || ''),
        makeError('file_transfer_unexpected', 'Unexpected file transfer'),
      );
      return;
    }
    try {
      if (Number(message.protocolVersion) !== contract.protocolVersion)
        throw makeError('protocol_mismatch', 'CLI protocol version mismatch');
      if (message.kind === contract.frames.fileBegin) {
        if (state.transferId) throw makeError('file_transfer_state', 'Duplicate file-begin frame');
        if (message.direction !== 'extension-to-host')
          throw makeError('file_transfer_direction', 'Invalid file transfer direction');
        const transferId = String(message.transferId || '').trim();
        if (!transferId || transferId.length > 256) throw makeError('file_transfer_id_invalid', 'Invalid transfer id');
        const totalBytes = Number(message.totalBytes);
        if (!Number.isSafeInteger(totalBytes) || totalBytes < 0)
          throw makeError('file_transfer_size_invalid', 'Invalid file transfer size');
        state.transferId = transferId;
        state.totalBytes = totalBytes;
        state.expectedSeq = 0;
        state.receivedBytes = 0;
        await write({
          kind: contract.frames.fileAck,
          protocolVersion: contract.protocolVersion,
          requestId,
          transferId,
          seq: -1,
        });
        armExportIdleTimeout(requestId, state);
        return;
      }

      const transferId = String(message.transferId || '');
      if (!state.transferId || transferId !== state.transferId)
        throw makeError('file_transfer_state', 'File transfer is not active');

      if (message.kind === contract.frames.fileChunk) {
        const seq = Number(message.seq);
        if (!Number.isInteger(seq) || seq !== state.expectedSeq) {
          throw makeError('file_transfer_sequence', 'Unexpected file chunk sequence', {
            expectedSeq: state.expectedSeq,
            receivedSeq: Number.isInteger(seq) ? seq : null,
          });
        }
        const bytes = decodeBase64Chunk(message.data, contract.fileTransfer.chunkBytes);
        if (state.receivedBytes + bytes.length > state.totalBytes) {
          throw makeError('file_transfer_size_mismatch', 'File chunk exceeds declared transfer size');
        }
        await state.receiver.write(bytes);
        state.receivedBytes += bytes.length;
        state.expectedSeq += 1;
        await write({
          kind: contract.frames.fileAck,
          protocolVersion: contract.protocolVersion,
          requestId,
          transferId,
          seq,
        });
        armExportIdleTimeout(requestId, state);
        return;
      }

      const seq = Number(message.seq);
      if (!Number.isInteger(seq) || seq !== state.expectedSeq)
        throw makeError('file_transfer_sequence', 'Unexpected file end sequence');
      if (state.receivedBytes !== state.totalBytes || Number(message.totalBytes) !== state.totalBytes) {
        throw makeError('file_transfer_size_mismatch', 'File transfer byte count mismatch');
      }
      const result = await state.receiver.finish({ totalBytes: state.totalBytes, sha256: message.sha256 });
      await write({
        kind: contract.frames.fileAck,
        protocolVersion: contract.protocolVersion,
        requestId,
        transferId,
        seq,
      });
      exportTransfers.delete(requestId);
      state.resolve(result);
    } catch (error) {
      await failExportTransfer(
        requestId,
        error instanceof Error ? error : new Error(String(error || 'File transfer failed')),
      );
    }
  };

  const handleMessage = async (message) => {
    if (closed || !message || typeof message !== 'object') return;
    if (message.kind === contract.frames.hello) {
      const compatible = Number(message.protocolVersion) === contract.protocolVersion;
      helloAccepted = compatible;
      await write({
        kind: contract.frames.helloAck,
        protocolVersion: contract.protocolVersion,
        ok: compatible,
        error: compatible ? null : { code: 'protocol_mismatch', message: 'CLI protocol version mismatch' },
      });
      if (compatible) {
        try {
          await onHello(message);
        } catch (error) {
          helloAccepted = false;
          close(error instanceof Error ? error : new Error(String(error || 'native_host_ipc_start_failed')));
          throw error;
        }
      }
      return;
    }

    if (message.kind === contract.frames.rpcResponse) {
      const requestId = String(message.requestId || '');
      const waiter = pending.get(requestId);
      if (!waiter) return;
      pending.delete(requestId);
      cleanupWaiter(waiter);
      waiter.resolve(message);
      return;
    }

    if (message.kind === contract.frames.fileAck) {
      const requestId = String(message.requestId || '');
      const transferId = String(message.transferId || '');
      const seq = Number(message.seq);
      if (!Number.isInteger(seq)) return;
      const key = ackKey(requestId, transferId, seq);
      const waiter = ackWaiters.get(key);
      if (!waiter) return;
      ackWaiters.delete(key);
      cleanupWaiter(waiter);
      if (Number(message.protocolVersion) !== contract.protocolVersion) {
        waiter.reject(makeError('protocol_mismatch', 'CLI protocol version mismatch'));
        return;
      }
      waiter.resolve();
      return;
    }

    if (message.kind === contract.frames.fileAbort) {
      const requestId = String(message.requestId || '');
      const transferId = String(message.transferId || '');
      const error = makeError(
        String(message.code || 'file_transfer_aborted'),
        String(message.message || 'File transfer aborted by extension'),
      );
      for (const [key, waiter] of ackWaiters.entries()) {
        if (!key.startsWith(`${requestId}\u0000${transferId}\u0000`)) continue;
        ackWaiters.delete(key);
        cleanupWaiter(waiter);
        waiter.reject(error);
      }
      await failExportTransfer(requestId, error, { notifyPeer: false });
      return;
    }

    if ([contract.frames.fileBegin, contract.frames.fileChunk, contract.frames.fileEnd].includes(message.kind)) {
      await handleExportFileFrame(message);
    }
  };

  const request = async (method, params = {}, options = {}) => {
    const { responsePromise } = await beginRequest(method, params, options);
    return await responsePromise;
  };

  const requestFileExport = async (method, params = {}, { outputPath, force = false, ...options } = {}) => {
    if (closed) throw makeError('native_host_closed', 'Native host is closed');
    if (!helloAccepted) throw makeError('native_host_not_ready', 'Native host is not ready');
    const receiver = await createOutputFileReceiver(outputPath, { force });
    const requestId = `rpc_${randomUUID()}`;
    let resolveTransfer;
    let rejectTransfer;
    const transferPromise = new Promise((resolve, reject) => {
      resolveTransfer = resolve;
      rejectTransfer = reject;
    });
    exportTransfers.set(requestId, {
      receiver,
      transferId: '',
      totalBytes: 0,
      expectedSeq: 0,
      receivedBytes: 0,
      timer: null,
      resolve: resolveTransfer,
      reject: rejectTransfer,
    });

    try {
      const { responsePromise } = await beginRequest(method, params, options, requestId);
      const first = await Promise.race([
        responsePromise.then((response) => ({ type: 'response', response })),
        transferPromise.then((file) => ({ type: 'file', file })),
      ]);
      let response;
      let file;
      if (first.type === 'response') {
        response = first.response;
        if (response?.ok !== true) {
          const state = exportTransfers.get(requestId);
          if (state) {
            exportTransfers.delete(requestId);
            await state.receiver.abort().catch(() => {});
            state.resolve(null);
          }
          return response;
        }
        file = await transferPromise;
      } else {
        file = first.file;
        response = await responsePromise;
      }
      if (response?.ok !== true) return response;
      return {
        ...response,
        data: {
          ...(response.data && typeof response.data === 'object' ? response.data : {}),
          path: file.path,
          byteSize: file.byteSize,
          sha256: file.sha256,
        },
      };
    } catch (error) {
      rejectPendingRequest(
        requestId,
        error instanceof Error ? error : new Error(String(error || 'File export failed')),
      );
      await failExportTransfer(
        requestId,
        error instanceof Error ? error : new Error(String(error || 'File export failed')),
      );
      throw error;
    }
  };

  const requestFileImport = async (method, params = {}, { inputPath, signal = null, ...options } = {}) => {
    if (closed) throw makeError('native_host_closed', 'Native host is closed');
    if (!helloAccepted) throw makeError('native_host_not_ready', 'Native host is not ready');
    const input = await openInputFile(inputPath);
    const requestId = `rpc_${randomUUID()}`;
    const transferId = `file_${randomUUID()}`;
    const hasher = createHash('sha256');
    let seq = 0;
    let responsePromise = null;
    try {
      ({ responsePromise } = await beginRequest(method, params, { ...options, signal }, requestId));
      await writeAndWaitFileAck(
        {
          kind: contract.frames.fileBegin,
          protocolVersion: contract.protocolVersion,
          requestId,
          transferId,
          direction: 'host-to-extension',
          totalBytes: input.byteSize,
          suggestedFilename: input.suggestedFilename,
          metadata: {},
        },
        -1,
        { signal },
      );

      for await (const bytes of readInputFileChunks(input.handle, input.byteSize, contract.fileTransfer.chunkBytes)) {
        hasher.update(bytes);
        await writeAndWaitFileAck(
          {
            kind: contract.frames.fileChunk,
            protocolVersion: contract.protocolVersion,
            requestId,
            transferId,
            seq,
            data: bytes.toString('base64'),
          },
          seq,
          { signal },
        );
        seq += 1;
      }

      const sha256 = hasher.digest('hex');
      await writeAndWaitFileAck(
        {
          kind: contract.frames.fileEnd,
          protocolVersion: contract.protocolVersion,
          requestId,
          transferId,
          seq,
          totalBytes: input.byteSize,
          sha256,
        },
        seq,
        { signal },
      );
      const response = await responsePromise;
      if (response?.ok !== true) return response;
      return {
        ...response,
        data: {
          ...(response.data && typeof response.data === 'object' ? response.data : {}),
          path: input.path,
          byteSize: input.byteSize,
          sha256,
        },
      };
    } catch (error) {
      await sendFileAbort(requestId, transferId, error);
      rejectPendingRequest(
        requestId,
        error instanceof Error ? error : new Error(String(error || 'File import failed')),
      );
      throw error;
    } finally {
      await input.handle.close().catch(() => {});
    }
  };

  return {
    handleMessage,
    request,
    requestFileExport,
    requestFileImport,
    close,
    isClosed: () => closed,
    isReady: () => helloAccepted && !closed,
  };
}

function localErrorResponse(code, message, extra = null) {
  return {
    protocolVersion: contract.protocolVersion,
    ok: false,
    data: null,
    error: { code, message, ...(extra == null ? null : { extra }) },
  };
}

async function listenServer(server, endpoint) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(endpoint);
  });
}

async function closeServer(server) {
  await new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function isConfirmedStaleEndpointError(error) {
  return ['ENOENT', 'ECONNREFUSED'].includes(String(error?.code || ''));
}

async function confirmCanonicalEndpointIsStale(endpoint, timeoutMs) {
  try {
    await requestEndpoint(
      endpoint,
      { method: 'system.ping', params: {} },
      { timeoutMs, maxResponseBytes: contract.nativeMessaging.extensionToHostMaxBytes },
    );
    throw new Error('cli_instance_already_online');
  } catch (error) {
    if (error?.message === 'cli_instance_already_online') throw error;
    if (!isConfirmedStaleEndpointError(error)) throw error;
    return String(error.code || '');
  }
}

export async function startNativeHostIpc({
  hello,
  protocol,
  runtimeRoot,
  uid = process.getuid?.(),
  pid = process.pid,
  processNonce = createProcessNonce(),
  startedAt = Date.now(),
  existingPingTimeoutMs = 500,
} = {}) {
  const cliInstanceId = String(hello?.cliInstanceId || '').trim();
  if (!cliInstanceId || cliInstanceId.length > 256) throw new Error('invalid_cli_instance_id');
  if (!protocol?.request) throw new Error('native_host_protocol_required');

  const runtimeDir = await ensureRuntimeDir({ root: runtimeRoot, uid });
  const endpoint = socketPathForInstance(runtimeDir, cliInstanceId);
  const registryPath = registryPathForInstance(runtimeDir, cliInstanceId);

  try {
    const existing = await readRegistryEntry(registryPath);
    try {
      await requestEndpoint(
        existing.endpoint,
        { method: 'system.ping', params: {} },
        { timeoutMs: existingPingTimeoutMs, maxResponseBytes: contract.nativeMessaging.extensionToHostMaxBytes },
      );
      throw new Error('cli_instance_already_online');
    } catch (error) {
      if (error?.message === 'cli_instance_already_online') throw error;
      if (!isConfirmedStaleEndpointError(error)) throw error;
    }
    const removed = await removeRegistryEntryIfOwned(registryPath, existing.processNonce).catch(() => false);
    if (!removed) throw new Error('cli_instance_registration_changed');
    if (String(existing.endpoint || '') === endpoint) await removeFileIfExists(endpoint);
  } catch (error) {
    const registryMissingOrInvalid =
      error?.code === 'ENOENT' ||
      error?.code === 'registry_invalid' ||
      error?.message === 'Unexpected end of JSON input' ||
      error instanceof SyntaxError;
    if (!registryMissingOrInvalid) throw error;

    const staleCode = await confirmCanonicalEndpointIsStale(endpoint, existingPingTimeoutMs);
    await removeFileIfExists(registryPath).catch(() => {});
    if (staleCode === 'ECONNREFUSED') await removeFileIfExists(endpoint).catch(() => {});
  }

  const sockets = new Set();
  let stopped = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    let requestAbortController = null;
    let requestSettled = true;
    socket.once('close', () => {
      sockets.delete(socket);
      if (!requestSettled && requestAbortController) {
        const error = new Error('CLI IPC client disconnected');
        error.code = 'native_host_client_disconnected';
        requestAbortController.abort(error);
      }
    });
    const reader = createJsonLineReader({
      timeoutMs: 5000,
      onValue(request) {
        const method = String(request?.method || '').trim();
        if (!method) {
          socket.end(encodeJsonLine(localErrorResponse('invalid_request', 'CLI IPC request method is required')));
          return;
        }
        const AbortControllerCtor = globalThis.AbortController;
        requestAbortController = AbortControllerCtor ? new AbortControllerCtor() : null;
        requestSettled = false;
        const params = request?.params && typeof request.params === 'object' ? request.params : {};
        const requestOptions = { timeoutMs: 0, signal: requestAbortController?.signal ?? null };
        let operation;
        if (method === 'export.markdown' || method === 'export.json' || method === 'backup.export') {
          if (!protocol?.requestFileExport) {
            operation = Promise.reject(
              Object.assign(new Error('Native host file export unavailable'), { code: 'file_transfer_unavailable' }),
            );
          } else {
            operation = protocol.requestFileExport(
              method,
              method === 'backup.export' ? {} : { conversationIds: params.conversationIds },
              {
                ...requestOptions,
                outputPath: params.outputPath,
                force: params.force === true,
              },
            );
          }
        } else if (method === 'backup.import') {
          if (!protocol?.requestFileImport) {
            operation = Promise.reject(
              Object.assign(new Error('Native host file import unavailable'), { code: 'file_transfer_unavailable' }),
            );
          } else {
            operation = protocol.requestFileImport(method, {}, { ...requestOptions, inputPath: params.inputPath });
          }
        } else {
          operation = protocol.request(method, params, requestOptions);
        }
        void operation
          .then((result) => {
            requestSettled = true;
            if (!socket.destroyed) socket.end(encodeJsonLine(result));
          })
          .catch((error) => {
            requestSettled = true;
            if (!socket.destroyed) {
              socket.end(
                encodeJsonLine(
                  localErrorResponse(
                    String(error?.code || 'transport_error'),
                    String(error?.message || error),
                    error?.extra ?? null,
                  ),
                ),
              );
            }
          });
      },
      onError(error) {
        if (!socket.destroyed) {
          socket.end(
            encodeJsonLine(localErrorResponse(String(error?.code || 'ipc_error'), String(error?.message || error))),
          );
        }
      },
    });
    socket.on('data', (chunk) => reader.push(chunk));
    socket.on('end', () => reader.end());
    socket.on('error', (error) => reader.error(error));
  });

  try {
    await listenServer(server, endpoint);
    await chmod(endpoint, 0o600);
    await writeRegistryEntry(registryPath, {
      cliInstanceId,
      endpoint,
      pid,
      processNonce,
      browserFamily: String(hello?.browserFamily || 'unknown'),
      runtimeId: String(hello?.runtimeId || ''),
      extensionVersion: String(hello?.extensionVersion || ''),
      protocolVersion: contract.protocolVersion,
      startedAt: Number(startedAt) || Date.now(),
    });
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await closeServer(server);
    await removeFileIfExists(endpoint).catch(() => {});
    throw error;
  }

  return {
    cliInstanceId,
    endpoint,
    registryPath,
    processNonce,
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
      const removed = await removeRegistryEntryIfOwned(registryPath, processNonce).catch(() => false);
      if (removed) await removeFileIfExists(endpoint).catch(() => false);
    },
  };
}

export function runNativeHost({
  input = process.stdin,
  output = process.stdout,
  error = process.stderr,
  runtimeRoot,
  startIpc = true,
} = {}) {
  const parser = new NativeMessageParser();
  let ipcController = null;
  let protocol = null;
  protocol = createNativeHostProtocol({
    write: (frame) => writeNativeMessage(output, frame),
    onHello: async (hello) => {
      if (!startIpc || ipcController) return;
      const started = await startNativeHostIpc({ hello, protocol, runtimeRoot });
      if (protocol.isClosed()) {
        await started.stop();
        return;
      }
      ipcController = started;
    },
    onClose: () => {
      const current = ipcController;
      ipcController = null;
      void current?.stop();
    },
  });
  let failed = false;

  const fail = (cause) => {
    if (failed) return;
    failed = true;
    protocol.close(cause instanceof Error ? cause : new Error(String(cause || 'native_host_failed')));
    try {
      error.write(`${String(cause?.message || cause || 'native_host_failed')}\n`);
    } catch {
      // ignore
    }
  };

  input.on('data', (chunk) => {
    if (failed) return;
    try {
      const messages = parser.push(chunk);
      for (const message of messages) void protocol.handleMessage(message).catch(fail);
    } catch (cause) {
      fail(cause);
    }
  });
  input.on('end', () => {
    if (failed) return;
    try {
      parser.finish();
      protocol.close(new Error('native_host_eof'));
    } catch (cause) {
      fail(cause);
    }
  });
  input.on('error', fail);
  return protocol;
}

function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return pathToFileURL(process.argv[1]).href === metaUrl;
  }
}

if (isMainModule(import.meta.url)) runNativeHost();
