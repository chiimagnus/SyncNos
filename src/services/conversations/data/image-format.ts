export type ImageFormat = 'png' | 'apng' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'avif' | 'unknown';
export type AnimationState = 'animated' | 'static' | 'unknown';
export type ImageFormatInspection = { format: ImageFormat; animation: AnimationState };

const HEADER_LIMIT = 64 * 1024;

function u32be(bytes: Uint8Array, at: number): number {
  return (bytes[at]! * 0x1000000 + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!) >>> 0;
}

function u32le(bytes: Uint8Array, at: number): number {
  return (bytes[at]! + (bytes[at + 1]! << 8) + (bytes[at + 2]! << 16) + bytes[at + 3]! * 0x1000000) >>> 0;
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function inspectPng(bytes: Uint8Array): ImageFormatInspection {
  let cursor = 8;
  while (cursor + 12 <= bytes.length) {
    const length = u32be(bytes, cursor);
    const kind = ascii(bytes, cursor + 4, 4);
    if (length > bytes.length - cursor - 12) return { format: 'png', animation: 'unknown' };
    if (kind === 'acTL') {
      if (length !== 8) return { format: 'apng', animation: 'unknown' };
      const frames = u32be(bytes, cursor + 8);
      return { format: 'apng', animation: frames > 1 ? 'animated' : frames === 1 ? 'static' : 'unknown' };
    }
    if (kind === 'IDAT' || kind === 'IEND') return { format: 'png', animation: 'static' };
    cursor += length + 12;
  }
  return { format: 'png', animation: 'unknown' };
}

function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
  let at = start;
  while (at < bytes.length) {
    const length = bytes[at++]!;
    if (length === 0) return at;
    if (at + length > bytes.length) return -1;
    at += length;
  }
  return -1;
}

function inspectGif(bytes: Uint8Array): AnimationState {
  if (bytes.length < 13) return 'unknown';
  const flags = bytes[10]!;
  let at = 13 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);
  let frames = 0;

  while (at < bytes.length) {
    const block = bytes[at]!;
    if (block === 0x3b) return frames === 1 ? 'static' : 'unknown';
    if (block === 0x21) {
      if (at + 2 > bytes.length) return 'unknown';
      at = skipGifSubBlocks(bytes, at + 2);
    } else if (block === 0x2c) {
      if (at + 11 > bytes.length) return 'unknown';
      const localFlags = bytes[at + 9]!;
      at += 10 + (localFlags & 0x80 ? 3 * (1 << ((localFlags & 7) + 1)) : 0);
      if (at >= bytes.length) return 'unknown';
      at = skipGifSubBlocks(bytes, at + 1);
      frames++;
      if (frames > 1) return 'animated';
    } else {
      return 'unknown';
    }
    if (at < 0) return 'unknown';
  }
  return 'unknown';
}

function inspectWebp(bytes: Uint8Array): AnimationState {
  if (bytes.length < 20) return 'unknown';
  const first = ascii(bytes, 12, 4);
  if (first === 'VP8 ' || first === 'VP8L') return 'static';
  if (first !== 'VP8X' || bytes.length < 21) return 'unknown';
  if (!(bytes[20]! & 0x02)) return 'static';
  let frames = 0;
  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const kind = ascii(bytes, cursor, 4);
    const length = u32le(bytes, cursor + 4);
    if (length > bytes.length - cursor - 8) return 'unknown';
    if (kind === 'ANMF' && length >= 16 && ++frames > 1) return 'animated';
    cursor += 8 + length + (length % 2);
  }
  return 'unknown';
}

/** Inspects a bounded header. Unknown means that safety cannot be established from these bytes. */
export async function inspectImageBlob(blob: Blob): Promise<ImageFormatInspection> {
  if (!(blob instanceof Blob) || blob.size === 0) return { format: 'unknown', animation: 'unknown' };
  const bytes = new Uint8Array(await blob.slice(0, HEADER_LIMIT).arrayBuffer());

  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    return inspectPng(bytes);
  }
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) {
    return { format: 'gif', animation: inspectGif(bytes) };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { format: 'webp', animation: inspectWebp(bytes) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { format: 'jpeg', animation: 'static' };
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp' && /^(?:avif|avis|mif1)$/.test(ascii(bytes, 8, 4))) {
    return { format: 'avif', animation: 'unknown' };
  }
  if (
    String(blob.type).toLowerCase().split(';')[0] === 'image/svg+xml' &&
    /<svg[\s>]/i.test(new TextDecoder().decode(bytes))
  ) {
    return { format: 'svg', animation: 'unknown' };
  }
  return { format: 'unknown', animation: 'unknown' };
}
