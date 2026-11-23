const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 4_194_304;
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = new Uint32Array(256);
for (let value = 0; value < 256; value++) {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  crcTable[value] = crc >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readU32(bytes: Uint8Array, at: number): number {
  return (bytes[at]! * 0x1000000 + bytes[at + 1]! * 65536 + bytes[at + 2]! * 256 + bytes[at + 3]!) >>> 0;
}

function writeU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = (value >>> 24) & 255;
  bytes[at + 1] = (value >>> 16) & 255;
  bytes[at + 2] = (value >>> 8) & 255;
  bytes[at + 3] = value & 255;
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Image optimization cancelled', 'AbortError');
}

function uncompressedSize(ihdr: Uint8Array): number | null {
  if (ihdr.length !== 13 || ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] !== 0) return null;
  const width = readU32(ihdr, 0);
  const height = readU32(ihdr, 4);
  const depth = ihdr[8]!;
  const kind = ihdr[9]!;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[kind];
  if (
    !channels ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_PIXELS ||
    height > Math.floor(MAX_PIXELS / width)
  )
    return null;
  const depths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (!depths[kind]?.includes(depth)) return null;
  return height * (1 + Math.ceil((width * channels * depth) / 8));
}

function pngStructure(bytes: Uint8Array): {
  idatStart: number;
  idatEnd: number;
  compressed: Uint8Array;
  expectedRawBytes: number;
} | null {
  if (bytes.length < 57 || !PNG_SIGNATURE.every((value, i) => bytes[i] === value)) return null;
  const parts: Uint8Array[] = [];
  let idatStart = -1;
  let idatEnd = -1;
  let expectedRawBytes: number | null = null;
  let endedIdat = false;
  let offset = PNG_SIGNATURE.length;
  let chunkCount = 0;
  let idatBytes = 0;

  while (offset + 12 <= bytes.length && chunkCount++ < 4096) {
    const length = readU32(bytes, offset);
    if (length > bytes.length - offset - 12) return null;
    const end = offset + 12 + length;
    const chunk = bytes.subarray(offset + 4, end - 4);
    if (crc32(chunk) !== readU32(bytes, end - 4)) return null;
    const kind = String.fromCharCode(...chunk.subarray(0, 4));
    if (!/^[A-Za-z]{4}$/.test(kind)) return null;
    if (chunkCount === 1) {
      if (kind !== 'IHDR') return null;
      expectedRawBytes = uncompressedSize(bytes.subarray(offset + 8, end - 4));
      if (expectedRawBytes == null) return null;
    } else if (kind === 'IHDR') {
      return null;
    }
    if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') return null;
    if (kind === 'IDAT') {
      if (endedIdat) return null;
      if (idatStart < 0) idatStart = offset;
      idatEnd = end;
      idatBytes += length;
      parts.push(bytes.subarray(offset + 8, end - 4));
    } else if (idatStart >= 0) {
      endedIdat = true;
    }
    if (kind === 'IEND') {
      if (length !== 0 || end !== bytes.length || idatStart < 0) return null;
      const compressed = new Uint8Array(idatBytes);
      let at = 0;
      for (const part of parts) {
        compressed.set(part, at);
        at += part.length;
      }
      return { idatStart, idatEnd, compressed, expectedRawBytes: expectedRawBytes! };
    }
    if (!['IHDR', 'PLTE', 'IDAT'].includes(kind) && /^[A-Z]/.test(kind)) return null;
    offset = end;
  }
  return null;
}

function idatChunk(compressed: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(compressed.length + 12);
  writeU32(chunk, 0, compressed.length);
  chunk.set([73, 68, 65, 84], 4);
  chunk.set(compressed, 8);
  writeU32(chunk, compressed.length + 8, crc32(chunk.subarray(4, compressed.length + 8)));
  return chunk;
}

async function transform(
  input: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const reader = new Blob([Uint8Array.from(input)]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let finished = false;
  try {
    while (true) {
      cancelled(signal);
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) return null;
      chunks.push(next.value);
    }
    cancelled(signal);
    const output = new Uint8Array(size);
    let position = 0;
    for (const chunk of chunks) {
      output.set(chunk, position);
      position += chunk.length;
    }
    finished = true;
    return output;
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

/** Recompresses only PNG IDAT scanlines. No pixel decoding, metadata loss or animation flattening. */
export async function recompressPngLosslessly(blob: Blob, signal?: AbortSignal): Promise<Blob | null> {
  cancelled(signal);
  if (blob.size <= 0 || blob.size > MAX_IMAGE_BYTES) return null;
  if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return null;
  const source = new Uint8Array(await blob.arrayBuffer());
  const structure = pngStructure(source);
  if (!structure) return null;
  const { compressed, expectedRawBytes, idatStart, idatEnd } = structure;
  const original = await transform(compressed, new DecompressionStream('deflate'), expectedRawBytes, signal);
  if (!original || original.length !== expectedRawBytes) return null;
  const recompressed = await transform(original, new CompressionStream('deflate'), compressed.length, signal);
  if (!recompressed) return null;
  const candidate = new Blob(
    [
      Uint8Array.from(source.subarray(0, idatStart)),
      Uint8Array.from(idatChunk(recompressed)),
      Uint8Array.from(source.subarray(idatEnd)),
    ],
    { type: 'image/png' },
  );
  if (candidate.size >= blob.size) return null;
  const verified = await transform(recompressed, new DecompressionStream('deflate'), expectedRawBytes, signal);
  if (!verified || !equalBytes(original, verified)) return null;
  cancelled(signal);
  return candidate;
}
