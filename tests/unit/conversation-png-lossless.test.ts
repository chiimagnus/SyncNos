import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzlibSync, zlibSync } from 'fflate';
import { recompressPngLosslessly } from '@platform/image/png-lossless';

const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function writeU32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 255;
  bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255;
  bytes[offset + 3] = value & 255;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name: string, data: Uint8Array = new Uint8Array()) {
  const out = new Uint8Array(data.length + 12);
  writeU32(out, 0, data.length);
  out.set(
    [...name].map((char) => char.charCodeAt(0)),
    4,
  );
  out.set(data, 8);
  writeU32(out, data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
}

function makeBytes(width = 64, height = 48) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * (width * 4 + 1) + 1 + x * 4;
      raw[at] = (x >> 2) * 13;
      raw[at + 1] = (y >> 2) * 17;
      raw[at + 2] = 56;
      raw[at + 3] = 255;
    }
  }
  return raw;
}

function png(
  input: {
    width?: number;
    height?: number;
    raw?: Uint8Array;
    level?: 0 | 9;
    splitIdat?: boolean;
    preIdat?: Uint8Array[];
    postIdat?: Uint8Array[];
    interlace?: number;
  } = {},
) {
  const width = input.width ?? 64;
  const height = input.height ?? 48;
  const raw = input.raw ?? makeBytes(width, height);
  const zlib = zlibSync(raw, { level: input.level ?? 0 });
  const ihdr = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 0, input.interlace ?? 0]);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  const idat = input.splitIdat
    ? [chunk('IDAT', zlib.subarray(0, 14)), chunk('IDAT', zlib.subarray(14))]
    : [chunk('IDAT', zlib)];
  return new Blob(
    [
      Uint8Array.from(signature),
      chunk('IHDR', ihdr),
      ...(input.preIdat || []),
      ...idat,
      ...(input.postIdat || []),
      chunk('IEND'),
    ].map((bytes) => Uint8Array.from(bytes)),
    { type: 'image/png' },
  );
}

async function parts(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let at = 8;
  const result: Array<{ name: string; data: Uint8Array; bytes: Uint8Array }> = [];
  while (at + 12 <= bytes.length) {
    const len = (bytes[at]! * 0x1000000 + bytes[at + 1]! * 65536 + bytes[at + 2]! * 256 + bytes[at + 3]!) >>> 0;
    const name = String.fromCharCode(...bytes.slice(at + 4, at + 8));
    result.push({ name, data: bytes.slice(at + 8, at + 8 + len), bytes: bytes.slice(at, at + len + 12) });
    at += len + 12;
    if (name === 'IEND') break;
  }
  return result;
}

function joinedIdat(chunks: Awaited<ReturnType<typeof parts>>) {
  const data = chunks.filter((entry) => entry.name === 'IDAT').map((entry) => entry.data);
  const joined = new Uint8Array(data.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const item of data) {
    joined.set(item, offset);
    offset += item.length;
  }
  return joined;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('native lossless PNG compression', () => {
  it('recompresses uncompressed IDAT while preserving decoded scanlines and text/color metadata exactly', async () => {
    const text = chunk('tEXt', new TextEncoder().encode('Author\0SyncNos demo'));
    const color = chunk('sRGB', Uint8Array.from([0]));
    const stamp = chunk('tIME', Uint8Array.from([7, 234, 11, 23, 12, 11, 10]));
    const source = png({ preIdat: [text, color], postIdat: [stamp] });
    const result = await recompressPngLosslessly(source);
    expect(result).toBeInstanceOf(Blob);
    expect(result!.type).toBe('image/png');
    expect(result!.size).toBeLessThan(source.size / 3);
    const [before, after] = await Promise.all([parts(source), parts(result!)]);
    expect(after.map((entry) => entry.name)).toEqual(before.map((entry) => entry.name));
    for (const name of ['IHDR', 'tEXt', 'sRGB', 'tIME', 'IEND']) {
      expect(after.find((entry) => entry.name === name)!.bytes).toEqual(
        before.find((entry) => entry.name === name)!.bytes,
      );
    }
    expect(unzlibSync(joinedIdat(after))).toEqual(unzlibSync(joinedIdat(before)));
  });

  it('supports consecutive IDAT chunks and preserves all non-IDAT bytes', async () => {
    const source = png({ splitIdat: true, postIdat: [chunk('tEXt', Uint8Array.from([65, 0, 66]))] });
    const result = await recompressPngLosslessly(source);
    expect(result).toBeInstanceOf(Blob);
    const [before, after] = await Promise.all([parts(source), parts(result!)]);
    expect(before.filter((part) => part.name === 'IDAT')).toHaveLength(2);
    expect(after.filter((part) => part.name === 'IDAT')).toHaveLength(1);
    expect(after.find((part) => part.name === 'tEXt')!.bytes).toEqual(
      before.find((part) => part.name === 'tEXt')!.bytes,
    );
    expect(unzlibSync(joinedIdat(after))).toEqual(unzlibSync(joinedIdat(before)));
  });

  it('refuses animation, unsupported critical chunks, interlace, invalid CRC and excess decoded data', async () => {
    const apng = png({ preIdat: [chunk('acTL', Uint8Array.from([0, 0, 0, 2, 0, 0, 0, 0]))] });
    const critical = png({ preIdat: [chunk('FOOB')] });
    const interlaced = png({ interlace: 1 });
    const malicious = png({ width: 1, height: 1, raw: makeBytes() });
    const original = png();
    const corrupt = new Uint8Array(await original.arrayBuffer());
    corrupt[45] ^= 0x01;
    for (const blob of [apng, critical, interlaced, malicious, new Blob([corrupt], { type: 'image/png' })]) {
      expect(await recompressPngLosslessly(blob)).toBeNull();
    }
  });

  it('does not rewrite images without savings, on cancellation or without browser compression support', async () => {
    const fullyCompressed = png({ level: 9 });
    expect(await recompressPngLosslessly(fullyCompressed)).toBeNull();
    const controller = new AbortController();
    controller.abort();
    await expect(recompressPngLosslessly(png(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    vi.stubGlobal('CompressionStream', undefined);
    expect(await recompressPngLosslessly(png())).toBeNull();
  });
});
