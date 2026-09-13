import { createServer } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createJsonLineReader, encodeJsonLine, requestEndpoint } from '../../cli/ipc.mjs';

function readerResult(options: { maxBytes?: number; timeoutMs?: number } = {}) {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const reader = createJsonLineReader({ ...options, onValue: resolve, onError: reject });
  return { reader, promise };
}

describe('CLI JSON Line IPC', () => {
  it('accepts fragmented input and exactly one JSON line', async () => {
    const { reader, promise } = readerResult();
    const encoded = encodeJsonLine({ method: 'system.ping', params: { a: 1 } });
    reader.push(encoded.subarray(0, 4));
    reader.push(encoded.subarray(4));
    await expect(promise).resolves.toEqual({ method: 'system.ping', params: { a: 1 } });
  });

  it('rejects malformed, multiple, truncated and oversized messages', async () => {
    const malformed = readerResult();
    malformed.reader.push(Buffer.from('{nope}\n'));
    await expect(malformed.promise).rejects.toMatchObject({ code: 'ipc_invalid_json' });

    const multiple = readerResult();
    multiple.reader.push(Buffer.from('{}\n{}\n'));
    await expect(multiple.promise).rejects.toMatchObject({ code: 'ipc_multiple_messages' });

    const truncated = readerResult();
    truncated.reader.push(Buffer.from('{}'));
    truncated.reader.end();
    await expect(truncated.promise).rejects.toMatchObject({ code: 'ipc_truncated' });

    const oversized = readerResult({ maxBytes: 4 });
    oversized.reader.push(Buffer.from('{"abcdef":1}'));
    await expect(oversized.promise).rejects.toMatchObject({ code: 'ipc_message_too_large' });
  });

  it('round-trips a real Unix socket response and times out if no JSON line arrives', async () => {
    const root = await mkdtemp(join(tmpdir(), 'syncnos-ipc-'));
    const endpoint = join(root, 'test.sock');
    const server = createServer((socket) => {
      let input = '';
      socket.on('data', (chunk) => {
        input += chunk.toString('utf8');
        if (!input.includes('\n')) return;
        const request = JSON.parse(input.trim());
        socket.write('{"ok":');
        socket.end(`${JSON.stringify(request.method === 'system.ping')}}\n`);
      });
    });
    await new Promise<void>((resolve) => server.listen(endpoint, resolve));
    await expect(requestEndpoint(endpoint, { method: 'system.ping' })).resolves.toEqual({ ok: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const hangingEndpoint = join(root, 'hang.sock');
    let hangingSocket: import('node:net').Socket | null = null;
    const hanging = createServer((socket) => {
      hangingSocket = socket;
    });
    await new Promise<void>((resolve) => hanging.listen(hangingEndpoint, resolve));
    await expect(requestEndpoint(hangingEndpoint, {}, { timeoutMs: 20 })).rejects.toMatchObject({
      code: 'ipc_timeout',
    });
    hangingSocket?.destroy();
    hanging.closeAllConnections?.();
    await new Promise<void>((resolve) => hanging.close(() => resolve()));
  });
});
