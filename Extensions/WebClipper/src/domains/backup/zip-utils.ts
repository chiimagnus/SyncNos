const SIG_LOCAL_FILE_HEADER = 0x04034b50;
const SIG_CENTRAL_DIR_FILE_HEADER = 0x02014b50;
const SIG_END_OF_CENTRAL_DIR = 0x06054b50;

function uint16LE(n: number) {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}

function uint32LE(n: number) {
  return new Uint8Array([
    n & 0xff,
    (n >>> 8) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 24) & 0xff,
  ]);
}

function concatBytes(chunks: Uint8Array[]) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function uint16At(bytes: Uint8Array, off: number) {
  return (bytes[off] | (bytes[off + 1] << 8)) >>> 0;
}

function uint32At(bytes: Uint8Array, off: number) {
  return (
    (bytes[off] |
      (bytes[off + 1] << 8) |
      (bytes[off + 2] << 16) |
      (bytes[off + 3] << 24)) >>>
    0
  );
}

function toDosDateTime(dateLike: unknown) {
  const d = dateLike instanceof Date ? dateLike : new Date((dateLike as any) || Date.now());
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = d.getHours();
  const minute = d.getMinutes();
  const second = Math.floor(d.getSeconds() / 2);
  const dosTime = (hour << 11) | (minute << 5) | second;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosDate, dosTime };
}

function normalizeEntryName(name: unknown, fallback: string) {
  const raw = String(name || '').trim() || fallback;
  return raw
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\.(\/|\\)/g, '')
    .replace(/[<>:"|?*]/g, '_');
}

async function toUint8Array(data: unknown): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  return new TextEncoder().encode(String(data == null ? '' : data));
}

function isUnsafeZipEntryName(name: unknown) {
  const text = String(name || '');
  if (!text) return true;
  if (text.includes('\0')) return true;
  if (text.startsWith('/') || text.startsWith('\\')) return true;
  if (/(^|[\\/])\.\.([\\/]|$)/.test(text)) return true;
  return false;
}

async function decompressDeflateRaw(bytes: Uint8Array, expectedSize?: number) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (typeof (globalThis as any).DecompressionStream !== 'undefined') {
    const tryFormats = ['deflate-raw', 'deflate'];
    for (const format of tryFormats) {
      try {
        const ds = new (globalThis as any).DecompressionStream(format);
        const stream = new Blob([input]).stream().pipeThrough(ds);
        const ab = await new Response(stream).arrayBuffer();
        return new Uint8Array(ab);
      } catch (_e) {
        // try fallback format / implementation
      }
    }
  }
  return inflateRawTiny(input, expectedSize);
}

// Minimal DEFLATE (raw) fallback implementation.
// Adapted from foliojs/tiny-inflate (MIT). We only need raw deflate for zip method=8.
const TINF_OK = 0;
const TINF_DATA_ERROR = -3;

function HuffmanTree(table: number[], lengths: number[], symbols: number[]) {
  this.table = table;
  this.lengths = lengths;
  this.symbols = symbols;
}

function TreeFromLengths(lengths: Uint8Array) {
  const MAXBITS = 15;
  const count = new Uint16Array(MAXBITS + 1);
  const offs = new Uint16Array(MAXBITS + 1);
  for (let i = 0; i < lengths.length; i += 1) {
    count[lengths[i]] += 1;
  }
  let sum = 0;
  for (let i = 1; i <= MAXBITS; i += 1) {
    offs[i] = sum;
    sum += count[i];
  }
  const symbols = new Uint16Array(sum);
  for (let i = 0; i < lengths.length; i += 1) {
    const l = lengths[i];
    if (l !== 0) symbols[offs[l]++] = i;
  }
  const table = new Uint16Array(1 << MAXBITS);
  for (let i = 0; i < table.length; i += 1) table[i] = 0xffff;
  let code = 0;
  for (let len = 1; len <= MAXBITS; len += 1) {
    for (let i = 0; i < count[len]; i += 1) {
      const sym = symbols[offs[len - 1] + i];
      let rev = 0;
      for (let j = 0; j < len; j += 1) {
        rev = (rev << 1) | ((code >>> j) & 1);
      }
      const fill = 1 << (MAXBITS - len);
      for (let j = 0; j < fill; j += 1) {
        table[rev | (j << len)] = sym;
      }
      code += 1;
    }
    code <<= 1;
  }
  return new (HuffmanTree as any)(table as any, lengths as any, symbols as any) as any;
}

function tinfGetBits(data: any, bitCount: number) {
  while (data.bitCount < bitCount) {
    if (data.inPos >= data.inLen) return -1;
    data.bitBuf |= data.inBuf[data.inPos++] << data.bitCount;
    data.bitCount += 8;
  }
  const out = data.bitBuf & ((1 << bitCount) - 1);
  data.bitBuf >>>= bitCount;
  data.bitCount -= bitCount;
  return out;
}

function tinfDecodeSymbol(data: any, tree: any) {
  const sym = tree.table[tinfGetBits(data, 15)];
  if (sym === 0xffff) return -1;
  const len = tree.lengths[sym];
  data.bitBuf >>>= len;
  data.bitCount -= len;
  return tree.symbols[sym];
}

function tinfInflateBlockData(data: any, out: Uint8Array, outPos: number, literalTree: any, distTree: any) {
  const lengthBase = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
    67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0,
  ];
  const lengthExtra = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4,
    5, 5, 5, 5, 0, 0, 0,
  ];
  const distBase = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385,
    513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
  ];
  const distExtra = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10,
    10, 11, 11, 12, 12, 13, 13,
  ];

  while (true) {
    const sym = tinfDecodeSymbol(data, literalTree);
    if (sym < 0) return TINF_DATA_ERROR;
    if (sym < 256) {
      out[outPos++] = sym;
      continue;
    }
    if (sym === 256) break;

    const lengthSym = sym - 257;
    let length = lengthBase[lengthSym];
    const le = lengthExtra[lengthSym];
    if (le) length += tinfGetBits(data, le);

    const distSym = tinfDecodeSymbol(data, distTree);
    if (distSym < 0) return TINF_DATA_ERROR;
    let dist = distBase[distSym];
    const de = distExtra[distSym];
    if (de) dist += tinfGetBits(data, de);

    let from = outPos - dist;
    for (let i = 0; i < length; i += 1) out[outPos++] = out[from++];
  }

  return outPos;
}

function tinfInflate(data: any, out: Uint8Array) {
  const fixedLengths = new Uint8Array(288);
  for (let i = 0; i < 144; i += 1) fixedLengths[i] = 8;
  for (let i = 144; i < 256; i += 1) fixedLengths[i] = 9;
  for (let i = 256; i < 280; i += 1) fixedLengths[i] = 7;
  for (let i = 280; i < 288; i += 1) fixedLengths[i] = 8;
  const fixedDist = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) fixedDist[i] = 5;

  const fixedLiteralTree = TreeFromLengths(fixedLengths);
  const fixedDistTree = TreeFromLengths(fixedDist);

  let outPos = 0;
  let finalBlock = 0;

  while (!finalBlock) {
    finalBlock = tinfGetBits(data, 1);
    const type = tinfGetBits(data, 2);

    if (type === 0) {
      data.bitBuf = 0;
      data.bitCount = 0;
      const len = tinfGetBits(data, 16);
      tinfGetBits(data, 16); // nlen
      if (len < 0) return TINF_DATA_ERROR;
      for (let i = 0; i < len; i += 1) {
        if (data.inPos >= data.inLen) return TINF_DATA_ERROR;
        out[outPos++] = data.inBuf[data.inPos++];
      }
      continue;
    }

    if (type === 1) {
      const res = tinfInflateBlockData(data, out, outPos, fixedLiteralTree, fixedDistTree);
      if (res < 0) return res;
      outPos = res;
      continue;
    }

    if (type === 2) {
      const hlit = tinfGetBits(data, 5) + 257;
      const hdist = tinfGetBits(data, 5) + 1;
      const hclen = tinfGetBits(data, 4) + 4;

      const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const codeLengths = new Uint8Array(19);
      for (let i = 0; i < hclen; i += 1) codeLengths[order[i]] = tinfGetBits(data, 3);
      const codeTree = TreeFromLengths(codeLengths);

      const lengths = new Uint8Array(hlit + hdist);
      for (let i = 0; i < lengths.length; ) {
        const sym = tinfDecodeSymbol(data, codeTree);
        if (sym < 0) return TINF_DATA_ERROR;
        if (sym < 16) {
          lengths[i++] = sym;
        } else {
          let count = 0;
          let val = 0;
          if (sym === 16) {
            count = tinfGetBits(data, 2) + 3;
            val = lengths[i - 1];
          } else if (sym === 17) {
            count = tinfGetBits(data, 3) + 3;
            val = 0;
          } else if (sym === 18) {
            count = tinfGetBits(data, 7) + 11;
            val = 0;
          }
          for (let j = 0; j < count; j += 1) lengths[i++] = val;
        }
      }

      const literalLengths = lengths.subarray(0, hlit);
      const distLengths = lengths.subarray(hlit);
      const literalTree = TreeFromLengths(literalLengths);
      const distTree = TreeFromLengths(distLengths.length ? distLengths : new Uint8Array([0]));

      const res = tinfInflateBlockData(data, out, outPos, literalTree, distTree);
      if (res < 0) return res;
      outPos = res;
      continue;
    }

    return TINF_DATA_ERROR;
  }

  return outPos;
}

function inflateRawTiny(input: Uint8Array, expectedSize?: number) {
  const outSize = Number.isFinite(expectedSize) && Number(expectedSize) > 0 ? Number(expectedSize) : input.length * 8;
  const out = new Uint8Array(outSize);
  const data: any = {
    inBuf: input,
    inPos: 0,
    inLen: input.length,
    bitBuf: 0,
    bitCount: 0,
  };
  const res = tinfInflate(data, out);
  if (res < 0) throw new Error('deflate decode failed');
  return out.subarray(0, res);
}

export type ZipInputEntry = {
  name: string;
  data: unknown;
  lastModified?: unknown;
};

export async function createZipBlob(entries: ZipInputEntry[]): Promise<Blob> {
  const normalized = Array.isArray(entries) ? entries : [];
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < normalized.length; i += 1) {
    const entry = normalized[i] || ({} as any);
    const name = normalizeEntryName(entry.name, `file-${i + 1}.txt`);
    const dataBytes = await toUint8Array(entry.data);
    const { dosDate, dosTime } = toDosDateTime(entry.lastModified);

    const hash = crc32(dataBytes);
    const size = dataBytes.length >>> 0;
    const nameBytes = new TextEncoder().encode(name);

    const localHeader = concatBytes([
      uint32LE(SIG_LOCAL_FILE_HEADER),
      uint16LE(20),
      uint16LE(0),
      uint16LE(0), // method=0 stored
      uint16LE(dosTime),
      uint16LE(dosDate),
      uint32LE(hash),
      uint32LE(size),
      uint32LE(size),
      uint16LE(nameBytes.length),
      uint16LE(0),
      nameBytes,
    ]);
    localChunks.push(localHeader, dataBytes);

    const centralHeader = concatBytes([
      uint32LE(SIG_CENTRAL_DIR_FILE_HEADER),
      uint16LE(20),
      uint16LE(20),
      uint16LE(0),
      uint16LE(0), // method=0 stored
      uint16LE(dosTime),
      uint16LE(dosDate),
      uint32LE(hash),
      uint32LE(size),
      uint32LE(size),
      uint16LE(nameBytes.length),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint32LE(0),
      uint32LE(offset),
      nameBytes,
    ]);
    centralChunks.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  }

  const centralDir = concatBytes(centralChunks);
  const localPart = concatBytes(localChunks);
  const endRecord = concatBytes([
    uint32LE(SIG_END_OF_CENTRAL_DIR),
    uint16LE(0),
    uint16LE(0),
    uint16LE(normalized.length),
    uint16LE(normalized.length),
    uint32LE(centralDir.length),
    uint32LE(localPart.length),
    uint16LE(0),
  ]);

  const zipBytes = concatBytes([localPart, centralDir, endRecord]);
  return new Blob([zipBytes], { type: 'application/zip' });
}

export async function extractZipEntries(blob: Blob): Promise<Map<string, Uint8Array>> {
  const inputBlob = blob instanceof Blob ? blob : new Blob([]);
  const ab = await inputBlob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const entries = new Map<string, Uint8Array>();

  // Find end of central directory.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65_535 - 22; i -= 1) {
    if (uint32At(bytes, i) === SIG_END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: missing end record');

  const entryCount = uint16At(bytes, eocd + 10);
  const centralDirSize = uint32At(bytes, eocd + 12);
  const centralDirOffset = uint32At(bytes, eocd + 16);

  if (centralDirOffset + centralDirSize > bytes.length) throw new Error('Invalid ZIP: central directory out of bounds');

  let off = centralDirOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (uint32At(bytes, off) !== SIG_CENTRAL_DIR_FILE_HEADER) throw new Error('Invalid ZIP: bad central dir header');

    const method = uint16At(bytes, off + 10);
    const hash = uint32At(bytes, off + 16);
    const compSize = uint32At(bytes, off + 20);
    const size = uint32At(bytes, off + 24);
    const nameLen = uint16At(bytes, off + 28);
    const extraLen = uint16At(bytes, off + 30);
    const commentLen = uint16At(bytes, off + 32);
    const localOffset = uint32At(bytes, off + 42);

    const nameBytes = bytes.subarray(off + 46, off + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    if (isUnsafeZipEntryName(name)) throw new Error('Invalid ZIP: unsafe entry name');

    off += 46 + nameLen + extraLen + commentLen;

    // Local header
    if (uint32At(bytes, localOffset) !== SIG_LOCAL_FILE_HEADER) throw new Error('Invalid ZIP: bad local header');
    const localNameLen = uint16At(bytes, localOffset + 26);
    const localExtraLen = uint16At(bytes, localOffset + 28);
    const dataOff = localOffset + 30 + localNameLen + localExtraLen;
    if (dataOff + compSize > bytes.length) throw new Error('Invalid ZIP: entry data out of bounds');

    const compressed = bytes.subarray(dataOff, dataOff + compSize);
    let data: Uint8Array;

    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = await decompressDeflateRaw(compressed, size);
    } else {
      throw new Error(`Unsupported ZIP compression method: ${method}`);
    }

    if (data.length !== size) {
      // Some zips may have unknown size; accept if data is at least not empty.
      if (size !== 0) throw new Error('Invalid ZIP: uncompressed size mismatch');
    }
    if (crc32(data) !== hash) throw new Error('Invalid ZIP: CRC mismatch');

    entries.set(name, data);
  }

  return entries;
}

