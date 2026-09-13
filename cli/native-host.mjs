#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { endianness } from 'node:os';
import process from 'node:process';
import { TextDecoder } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function readContract() {
  const candidates = [
    join(SCRIPT_DIR, 'cli-rpc-contract.json'),
    join(SCRIPT_DIR, '..', 'src', 'services', 'protocols', 'cli-rpc-contract.json'),
  ];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8'));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('CLI RPC contract not found');
}

export const contract = readContract();
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

export function createNativeHostProtocol({ write = (frame) => writeNativeMessage(process.stdout, frame) } = {}) {
  let closed = false;
  let helloAccepted = false;
  const pending = new Map();

  const close = (error = new Error('native_host_closed')) => {
    if (closed) return;
    closed = true;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
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
      return;
    }

    if (message.kind === contract.frames.rpcResponse) {
      const requestId = String(message.requestId || '');
      const waiter = pending.get(requestId);
      if (!waiter) return;
      pending.delete(requestId);
      waiter.resolve(message);
    }
  };

  const request = async (method, params = {}) => {
    if (closed) throw new Error('native_host_closed');
    if (!helloAccepted) throw new Error('native_host_not_ready');
    const requestId = `rpc_${randomUUID()}`;
    const responsePromise = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    try {
      await write({
        kind: contract.frames.rpcRequest,
        protocolVersion: contract.protocolVersion,
        requestId,
        method,
        params,
      });
    } catch (error) {
      pending.delete(requestId);
      throw error;
    }
    return await responsePromise;
  };

  return { handleMessage, request, close };
}

export function runNativeHost({ input = process.stdin, output = process.stdout, error = process.stderr } = {}) {
  const parser = new NativeMessageParser();
  const protocol = createNativeHostProtocol({ write: (frame) => writeNativeMessage(output, frame) });
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
