import { MAX_STREAM_FRAME_BYTES } from '@services/local-data/contracts';

/** Native Messaging frames use the same UTF-8 JSON ceiling as every P1 wire frame. */
export const MAX_NATIVE_MESSAGING_JSON_BYTES = MAX_STREAM_FRAME_BYTES;

export type NativeMessagingInput = AsyncIterable<Uint8Array>;

export type NativeMessagingOutput = Readonly<{
  write: (chunk: Uint8Array, callback?: (error?: Error | null) => void) => boolean;
}>;

export class NativeMessagingFramingError extends Error {
  constructor(readonly code: 'EOF' | 'FRAME_TOO_LARGE' | 'INVALID_FRAME' | 'INVALID_JSON' | 'WRITE_FAILED') {
    super('Invalid Native Messaging frame.');
    this.name = 'NativeMessagingFramingError';
  }
}

function framingFailure(code: NativeMessagingFramingError['code']): never {
  throw new NativeMessagingFramingError(code);
}

function uint32LittleEndian(bytes: Uint8Array): number {
  return bytes[0]! + bytes[1]! * 0x100 + bytes[2]! * 0x10000 + bytes[3]! * 0x1000000;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (_error) {
    return framingFailure('INVALID_JSON');
  }
}

/**
 * Decodes Native Messaging frames incrementally. It never accumulates more than one
 * already-declared, P1-bounded JSON payload.
 */
export async function* readNativeMessages(
  input: NativeMessagingInput,
  maximumBytes = MAX_NATIVE_MESSAGING_JSON_BYTES,
): AsyncGenerator<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > MAX_NATIVE_MESSAGING_JSON_BYTES) {
    framingFailure('INVALID_FRAME');
  }

  const header = new Uint8Array(4);
  let headerLength = 0;
  let payload: Uint8Array | null = null;
  let payloadLength = 0;

  for await (const candidate of input) {
    if (!(candidate instanceof Uint8Array)) framingFailure('INVALID_FRAME');
    let offset = 0;
    while (offset < candidate.byteLength) {
      if (!payload) {
        const copied = Math.min(4 - headerLength, candidate.byteLength - offset);
        header.set(candidate.subarray(offset, offset + copied), headerLength);
        headerLength += copied;
        offset += copied;
        if (headerLength < 4) continue;

        const declaredLength = uint32LittleEndian(header);
        headerLength = 0;
        if (!declaredLength) framingFailure('INVALID_FRAME');
        if (declaredLength > maximumBytes) framingFailure('FRAME_TOO_LARGE');
        payload = new Uint8Array(declaredLength);
        payloadLength = 0;
      }

      const copied = Math.min(payload.byteLength - payloadLength, candidate.byteLength - offset);
      payload.set(candidate.subarray(offset, offset + copied), payloadLength);
      payloadLength += copied;
      offset += copied;
      if (payloadLength !== payload.byteLength) continue;

      const complete = payload;
      payload = null;
      payloadLength = 0;
      yield decodeJson(complete);
    }
  }

  if (headerLength || payload) framingFailure('EOF');
}

export function encodeNativeMessage(value: unknown, maximumBytes = MAX_NATIVE_MESSAGING_JSON_BYTES): Uint8Array {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > MAX_NATIVE_MESSAGING_JSON_BYTES) {
    framingFailure('INVALID_FRAME');
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (_error) {
    return framingFailure('INVALID_JSON');
  }
  if (typeof serialized !== 'string') return framingFailure('INVALID_JSON');
  const payload = new TextEncoder().encode(serialized);
  if (!payload.byteLength || payload.byteLength > maximumBytes) framingFailure('FRAME_TOO_LARGE');

  const frame = new Uint8Array(4 + payload.byteLength);
  new DataView(frame.buffer, frame.byteOffset, 4).setUint32(0, payload.byteLength, true);
  frame.set(payload, 4);
  return frame;
}

/** Writes one complete binary frame; callers must never write diagnostics through this surface. */
export async function writeNativeMessage(output: NativeMessagingOutput, value: unknown): Promise<void> {
  const frame = encodeNativeMessage(value);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      if (error) reject(new NativeMessagingFramingError('WRITE_FAILED'));
      else resolve();
    };
    try {
      output.write(frame, finish);
    } catch (_error) {
      finish(new Error('write failed'));
    }
  });
}
