#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { endianness } from 'node:os';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { TextDecoder } from 'node:util';
import { pathToFileURL } from 'node:url';

import { contract } from './contract.mjs';
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

  const close = (error = new Error('native_host_closed')) => {
    if (closed) return;
    closed = true;
    for (const { reject, timer } of pending.values()) {
      if (timer) clearTimeout(timer);
      reject(error);
    }
    pending.clear();
    try {
      void onClose(error);
    } catch {
      // ignore cleanup callback failures
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
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  };

  const request = async (method, params = {}) => {
    if (closed) throw new Error('native_host_closed');
    if (!helloAccepted) throw new Error('native_host_not_ready');
    const requestId = `rpc_${randomUUID()}`;
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = Number(requestTimeoutMs);
      const timer =
        Number.isFinite(timeout) && timeout > 0
          ? setTimeout(() => {
              const waiter = pending.get(requestId);
              if (!waiter) return;
              pending.delete(requestId);
              const error = new Error('Native Messaging RPC timed out');
              error.code = 'native_host_request_timeout';
              waiter.reject(error);
            }, timeout)
          : null;
      pending.set(requestId, { resolve, reject, timer });
    });
    try {
      await write({
        kind: contract.frames.rpcRequest,
        protocolVersion: contract.protocolVersion,
        requestId,
        method,
        params,
      });
    } catch (error) {
      const waiter = pending.get(requestId);
      pending.delete(requestId);
      if (waiter?.timer) clearTimeout(waiter.timer);
      waiter?.reject(error);
    }
    return await responsePromise;
  };

  return { handleMessage, request, close, isClosed: () => closed, isReady: () => helloAccepted && !closed };
}

function localErrorResponse(code, message) {
  return {
    protocolVersion: contract.protocolVersion,
    ok: false,
    data: null,
    error: { code, message },
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
    socket.once('close', () => sockets.delete(socket));
    const reader = createJsonLineReader({
      timeoutMs: 5000,
      onValue(request) {
        const method = String(request?.method || '').trim();
        if (!method) {
          socket.end(encodeJsonLine(localErrorResponse('invalid_request', 'CLI IPC request method is required')));
          return;
        }
        void protocol
          .request(method, request?.params ?? {})
          .then((result) => {
            if (!socket.destroyed) socket.end(encodeJsonLine(result));
          })
          .catch((error) => {
            if (!socket.destroyed) {
              socket.end(
                encodeJsonLine(
                  localErrorResponse(String(error?.code || 'transport_error'), String(error?.message || error)),
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

const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) runNativeHost();
