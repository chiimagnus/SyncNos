import { describe, expect, it, vi } from 'vitest';

import {
  MAX_NATIVE_MESSAGING_JSON_BYTES,
  NativeMessagingFramingError,
  encodeNativeMessage,
  readNativeMessages,
  writeNativeMessage,
} from '../../packages/syncnoscli/src/native-host/stdio';

async function collect(input: AsyncIterable<Uint8Array>): Promise<unknown[]> {
  const messages: unknown[] = [];
  for await (const message of readNativeMessages(input)) messages.push(message);
  return messages;
}

async function* chunks(values: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield value;
}

function joinFrames(frames: readonly Uint8Array[]): Uint8Array {
  const total = frames.reduce((sum, frame) => sum + frame.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const frame of frames) {
    joined.set(frame, offset);
    offset += frame.byteLength;
  }
  return joined;
}

function framingError(error: unknown, code: NativeMessagingFramingError['code']): void {
  expect(error).toBeInstanceOf(NativeMessagingFramingError);
  expect((error as NativeMessagingFramingError).code).toBe(code);
}

describe('Native Host stdio framing', () => {
  it('handles arbitrarily split little-endian frames without emitting text delimiters', async () => {
    const first = encodeNativeMessage({ requestId: 'one', value: '你好😀' });
    const second = encodeNativeMessage({ requestId: 'two', value: 2 });
    const joined = joinFrames([first, second]);

    await expect(
      collect(
        chunks([
          joined.subarray(0, 1),
          joined.subarray(1, 7),
          joined.subarray(7, first.byteLength + 2),
          joined.subarray(first.byteLength + 2),
        ]),
      ),
    ).resolves.toEqual([
      { requestId: 'one', value: '你好😀' },
      { requestId: 'two', value: 2 },
    ]);

    const writes: Uint8Array[] = [];
    const write = vi.fn((chunk: Uint8Array, callback?: (error?: Error | null) => void) => {
      writes.push(Uint8Array.from(chunk));
      callback?.();
      return true;
    });
    await writeNativeMessage({ write }, { ok: true, value: '二进制' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(writes[0]?.includes(10)).toBe(false);
    await expect(collect(chunks(writes))).resolves.toEqual([{ ok: true, value: '二进制' }]);
  });

  it('fails closed before buffering an oversized payload and on malformed EOF/JSON', async () => {
    const oversizedHeader = new Uint8Array(4);
    new DataView(oversizedHeader.buffer).setUint32(0, MAX_NATIVE_MESSAGING_JSON_BYTES + 1, true);
    await expect(collect(chunks([oversizedHeader]))).rejects.toSatisfy((error: unknown) => {
      framingError(error, 'FRAME_TOO_LARGE');
      return true;
    });

    const partial = encodeNativeMessage({ valid: true }).subarray(0, 5);
    await expect(collect(chunks([partial]))).rejects.toSatisfy((error: unknown) => {
      framingError(error, 'EOF');
      return true;
    });

    const invalidJson = new Uint8Array(4 + 1);
    new DataView(invalidJson.buffer).setUint32(0, 1, true);
    invalidJson[4] = 0x7b;
    await expect(collect(chunks([invalidJson]))).rejects.toSatisfy((error: unknown) => {
      framingError(error, 'INVALID_JSON');
      return true;
    });
  });

  it('rejects response values that cannot be represented in one bounded JSON frame', () => {
    expect(() => encodeNativeMessage(undefined)).toThrow(NativeMessagingFramingError);
    expect(() => encodeNativeMessage({ body: 'x'.repeat(MAX_NATIVE_MESSAGING_JSON_BYTES) })).toThrow(
      NativeMessagingFramingError,
    );
  });
});
