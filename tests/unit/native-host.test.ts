import { EventEmitter } from 'node:events';
import { endianness } from 'node:os';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  NativeMessageParser,
  contract,
  createNativeHostProtocol,
  encodeNativeMessage,
  runNativeHost,
  writeNativeMessage,
} from '../../cli/native-host.mjs';

function header(length: number) {
  const buffer = Buffer.alloc(4);
  if (endianness() === 'LE') buffer.writeUInt32LE(length, 0);
  else buffer.writeUInt32BE(length, 0);
  return buffer;
}

describe('native host framing', () => {
  it('parses split and concatenated Native Messaging frames', () => {
    const parser = new NativeMessageParser();
    const first = encodeNativeMessage({ kind: 'one', value: 1 });
    const second = encodeNativeMessage({ kind: 'two', value: 2 });

    expect(parser.push(first.subarray(0, 2))).toEqual([]);
    expect(parser.push(Buffer.concat([first.subarray(2), second]))).toEqual([
      { kind: 'one', value: 1 },
      { kind: 'two', value: 2 },
    ]);
    expect(() => parser.finish()).not.toThrow();
  });

  it('rejects empty, oversized, invalid JSON and truncated frames deterministically', () => {
    expect(() => new NativeMessageParser().push(header(0))).toThrow('native_message_empty');
    expect(() => new NativeMessageParser(8).push(header(9))).toThrow('native_message_too_large');

    const invalidJson = Buffer.concat([header(1), Buffer.from('{')]);
    expect(() => new NativeMessageParser().push(invalidJson)).toThrow('native_message_invalid_json');

    const truncated = new NativeMessageParser();
    truncated.push(Buffer.concat([header(10), Buffer.from('{}')]));
    expect(() => truncated.finish()).toThrow('native_message_truncated');
  });

  it('waits for stdout backpressure before resolving', async () => {
    class BackpressuredStream extends EventEmitter {
      write = vi.fn(() => false);
    }
    const stream = new BackpressuredStream();
    let settled = false;
    const pending = writeNativeMessage(stream, { kind: 'hello' }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    stream.emit('drain');
    await pending;
    expect(settled).toBe(true);
    expect(stream.write).toHaveBeenCalledTimes(1);
  });

  it('rejects a stdout write error while backpressured', async () => {
    class FailingStream extends EventEmitter {
      write = vi.fn(() => false);
    }
    const stream = new FailingStream();
    const pending = writeNativeMessage(stream, { kind: 'hello' });
    stream.emit('error', new Error('stdout failed'));
    await expect(pending).rejects.toThrow('stdout failed');
  });

  it('rejects host-to-extension payloads above the real 1 MiB boundary', () => {
    const oversized = { payload: 'x'.repeat(contract.nativeMessaging.hostToExtensionMaxBytes) };
    expect(() => encodeNativeMessage(oversized)).toThrow('native_message_too_large');
  });

  it('performs hello negotiation and correlates RPC responses', async () => {
    const written: any[] = [];
    const protocol = createNativeHostProtocol({ write: async (frame: unknown) => written.push(frame) });
    await protocol.handleMessage({ kind: contract.frames.hello, protocolVersion: contract.protocolVersion });
    expect(written[0]).toMatchObject({ kind: contract.frames.helloAck, ok: true });

    const pending = protocol.request('system.ping');
    await vi.waitFor(() => expect(written.length).toBe(2));
    const request = written[1];
    expect(request).toMatchObject({ kind: contract.frames.rpcRequest, method: 'system.ping' });
    await protocol.handleMessage({
      kind: contract.frames.rpcResponse,
      protocolVersion: contract.protocolVersion,
      requestId: request.requestId,
      ok: true,
      data: { alive: true },
      error: null,
    });
    await expect(pending).resolves.toMatchObject({ ok: true, data: { alive: true } });
  });

  it('rejects every pending request when browser stdin reaches EOF', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const error = new PassThrough();
    const protocol = runNativeHost({ input, output, error });
    input.write(encodeNativeMessage({ kind: contract.frames.hello, protocolVersion: contract.protocolVersion }));
    await new Promise((resolve) => setImmediate(resolve));

    const pending = protocol.request('system.ping');
    input.end();
    await expect(pending).rejects.toThrow('native_host_eof');
    expect(error.read()?.toString() || '').toBe('');
  });
});
