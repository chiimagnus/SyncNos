import { Buffer } from 'node:buffer';
import net from 'node:net';
import { clearTimeout, setTimeout } from 'node:timers';

export const DEFAULT_IPC_TIMEOUT_MS = 5000;

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

export function encodeJsonLine(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

export function createJsonLineReader({ maxBytes, timeoutMs = DEFAULT_IPC_TIMEOUT_MS, onValue, onError }) {
  let buffer = Buffer.alloc(0);
  let settled = false;
  let timer = null;

  const fail = (error) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    onError(error);
  };

  const succeed = (value) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    onValue(value);
  };

  if (timeoutMs > 0) {
    timer = setTimeout(() => fail(codedError('ipc_timeout', 'CLI IPC timed out')), timeoutMs);
    timer.unref?.();
  }

  return {
    push(chunk) {
      if (settled) return;
      const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffer = buffer.length ? Buffer.concat([buffer, next]) : next;
      if (Number.isFinite(maxBytes) && buffer.length > maxBytes + 1) {
        fail(codedError('ipc_message_too_large', 'CLI IPC message exceeds the protocol limit'));
        return;
      }
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      if (newline !== buffer.length - 1 || buffer.subarray(newline + 1).length !== 0) {
        fail(codedError('ipc_multiple_messages', 'CLI IPC accepts exactly one request per connection'));
        return;
      }
      const line = buffer.subarray(0, newline);
      if (!line.length) {
        fail(codedError('ipc_invalid_json', 'CLI IPC request is empty'));
        return;
      }
      try {
        succeed(JSON.parse(line.toString('utf8')));
      } catch {
        fail(codedError('ipc_invalid_json', 'CLI IPC message is not valid JSON'));
      }
    },
    end() {
      if (!settled) fail(codedError('ipc_truncated', 'CLI IPC connection ended before a complete JSON line'));
    },
    error(error) {
      fail(error instanceof Error ? error : codedError('ipc_error', String(error || 'CLI IPC failed')));
    },
    cancel() {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export async function requestEndpoint(
  endpoint,
  request,
  { timeoutMs = DEFAULT_IPC_TIMEOUT_MS, maxResponseBytes = 64 * 1024 * 1024 } = {},
) {
  const path = String(endpoint || '').trim();
  if (!path) throw codedError('instance_endpoint_missing', 'CLI instance endpoint is missing');
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ path });
    const reader = createJsonLineReader({
      maxBytes: maxResponseBytes,
      timeoutMs,
      onValue(value) {
        socket.end();
        resolve(value);
      },
      onError(error) {
        socket.destroy();
        reject(error);
      },
    });
    socket.on('connect', () => {
      try {
        socket.write(encodeJsonLine(request));
      } catch (error) {
        reader.error(error);
      }
    });
    socket.on('data', (chunk) => reader.push(chunk));
    socket.on('end', () => reader.end());
    socket.on('error', (error) => reader.error(error));
  });
}
