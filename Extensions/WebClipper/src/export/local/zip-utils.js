(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const SIG_LOCAL_FILE_HEADER = 0x04034b50;
  const SIG_CENTRAL_DIR_FILE_HEADER = 0x02014b50;
  const SIG_END_OF_CENTRAL_DIR = 0x06054b50;

  function uint16LE(n) {
    return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  }

  function uint32LE(n) {
    return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  }

  function concatBytes(chunks) {
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
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function uint16At(bytes, off) {
    return (bytes[off] | (bytes[off + 1] << 8)) >>> 0;
  }

  function uint32At(bytes, off) {
    return (bytes[off]
      | (bytes[off + 1] << 8)
      | (bytes[off + 2] << 16)
      | (bytes[off + 3] << 24)) >>> 0;
  }

  function toDosDateTime(dateLike) {
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike || Date.now());
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

  function normalizeEntryName(name, fallback) {
    const raw = String(name || "").trim() || fallback;
    return raw
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\.\.(\/|\\)/g, "")
      .replace(/[<>:"|?*]/g, "_");
  }

  async function toUint8Array(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof Blob !== "undefined" && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    return new TextEncoder().encode(String(data == null ? "" : data));
  }

  function isUnsafeZipEntryName(name) {
    const text = String(name || "");
    if (!text) return true;
    if (text.includes("\0")) return true;
    if (text.startsWith("/") || text.startsWith("\\")) return true;
    if (/(^|[\\/])\.\.([\\/]|$)/.test(text)) return true;
    return false;
  }

  async function decompressDeflateRaw(bytes, expectedSize) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (typeof DecompressionStream !== "undefined") {
      const tryFormats = ["deflate-raw", "deflate"];
      for (const format of tryFormats) {
        try {
          const ds = new DecompressionStream(format);
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

  function TinyTree() {
    this.table = new Uint16Array(16);
    this.trans = new Uint16Array(288);
  }

  function TinyData(source, dest) {
    this.source = source;
    this.sourceIndex = 0;
    this.tag = 0;
    this.bitcount = 0;

    this.dest = dest;
    this.destLen = 0;

    this.ltree = new TinyTree();
    this.dtree = new TinyTree();
  }

  const tinyFixedLTree = new TinyTree();
  const tinyFixedDTree = new TinyTree();
  const tinyLengthBits = new Uint8Array(30);
  const tinyLengthBase = new Uint16Array(30);
  const tinyDistBits = new Uint8Array(30);
  const tinyDistBase = new Uint16Array(30);
  const tinyClcIdx = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

  const tinyCodeTree = new TinyTree();
  const tinyLengths = new Uint8Array(288 + 32);
  const tinyOffs = new Uint16Array(16);

  function tinyBuildBitsBase(bits, base, delta, first) {
    for (let i = 0; i < delta; i += 1) bits[i] = 0;
    for (let i = 0; i < 30 - delta; i += 1) bits[i + delta] = (i / delta) | 0;

    let sum = first;
    for (let i = 0; i < 30; i += 1) {
      base[i] = sum;
      sum += 1 << bits[i];
    }
  }

  function tinyBuildFixedTrees(lt, dt) {
    for (let i = 0; i < 7; i += 1) lt.table[i] = 0;
    lt.table[7] = 24;
    lt.table[8] = 152;
    lt.table[9] = 112;

    for (let i = 0; i < 24; i += 1) lt.trans[i] = 256 + i;
    for (let i = 0; i < 144; i += 1) lt.trans[24 + i] = i;
    for (let i = 0; i < 8; i += 1) lt.trans[24 + 144 + i] = 280 + i;
    for (let i = 0; i < 112; i += 1) lt.trans[24 + 144 + 8 + i] = 144 + i;

    for (let i = 0; i < 5; i += 1) dt.table[i] = 0;
    dt.table[5] = 32;
    for (let i = 0; i < 32; i += 1) dt.trans[i] = i;
  }

  function tinyBuildTree(t, lengths, off, num) {
    for (let i = 0; i < 16; i += 1) t.table[i] = 0;
    for (let i = 0; i < num; i += 1) t.table[lengths[off + i]] += 1;
    t.table[0] = 0;

    let sum = 0;
    for (let i = 0; i < 16; i += 1) {
      tinyOffs[i] = sum;
      sum += t.table[i];
    }

    for (let i = 0; i < num; i += 1) {
      const len = lengths[off + i];
      if (len) t.trans[tinyOffs[len]++] = i;
    }
  }

  function tinyGetBit(d) {
    if (!d.bitcount--) {
      d.tag = d.source[d.sourceIndex++];
      d.bitcount = 7;
    }
    const bit = d.tag & 1;
    d.tag >>>= 1;
    return bit;
  }

  function tinyReadBits(d, num, base) {
    if (!num) return base;
    while (d.bitcount < 24) {
      d.tag |= d.source[d.sourceIndex++] << d.bitcount;
      d.bitcount += 8;
    }
    const val = d.tag & (0xffff >>> (16 - num));
    d.tag >>>= num;
    d.bitcount -= num;
    return val + base;
  }

  function tinyDecodeSymbol(d, t) {
    while (d.bitcount < 24) {
      d.tag |= d.source[d.sourceIndex++] << d.bitcount;
      d.bitcount += 8;
    }

    let sum = 0;
    let cur = 0;
    let len = 0;
    let tag = d.tag;
    do {
      cur = (cur << 1) | (tag & 1);
      tag >>>= 1;
      len += 1;
      sum += t.table[len];
      cur -= t.table[len];
    } while (cur >= 0);

    d.tag = tag;
    d.bitcount -= len;

    return t.trans[sum + cur];
  }

  function tinyDecodeTrees(d, lt, dt) {
    let hlit = tinyReadBits(d, 5, 257);
    let hdist = tinyReadBits(d, 5, 1);
    let hclen = tinyReadBits(d, 4, 4);

    for (let i = 0; i < 19; i += 1) tinyLengths[i] = 0;
    for (let i = 0; i < hclen; i += 1) tinyLengths[tinyClcIdx[i]] = tinyReadBits(d, 3, 0);

    tinyBuildTree(tinyCodeTree, tinyLengths, 0, 19);

    const num = hlit + hdist;
    let idx = 0;
    while (idx < num) {
      const sym = tinyDecodeSymbol(d, tinyCodeTree);
      if (sym < 16) {
        tinyLengths[idx++] = sym;
        continue;
      }
      let length = 0;
      if (sym === 16) length = tinyReadBits(d, 2, 3);
      else if (sym === 17) length = tinyReadBits(d, 3, 3);
      else if (sym === 18) length = tinyReadBits(d, 7, 11);
      const fill = sym === 16 ? tinyLengths[idx - 1] : 0;
      for (let i = 0; i < length; i += 1) tinyLengths[idx++] = fill;
    }

    tinyBuildTree(lt, tinyLengths, 0, hlit);
    tinyBuildTree(dt, tinyLengths, hlit, hdist);
  }

  function tinyInflateUncompressedBlock(d) {
    d.bitcount = 0;

    const len = d.source[d.sourceIndex++] | (d.source[d.sourceIndex++] << 8);
    const nlen = d.source[d.sourceIndex++] | (d.source[d.sourceIndex++] << 8);
    if ((len ^ 0xffff) !== nlen) return TINF_DATA_ERROR;

    if (d.sourceIndex + len > d.source.length) return TINF_DATA_ERROR;
    if (d.destLen + len > d.dest.length) return TINF_DATA_ERROR;

    for (let i = 0; i < len; i += 1) d.dest[d.destLen++] = d.source[d.sourceIndex++];
    return TINF_OK;
  }

  function tinyInflateBlockData(d, lt, dt) {
    while (true) {
      const sym = tinyDecodeSymbol(d, lt);
      if (sym < 256) {
        if (d.destLen >= d.dest.length) return TINF_DATA_ERROR;
        d.dest[d.destLen++] = sym;
        continue;
      }
      if (sym === 256) return TINF_OK;

      const lengthSym = sym - 257;
      if (lengthSym < 0 || lengthSym >= 29) return TINF_DATA_ERROR;
      let length = tinyReadBits(d, tinyLengthBits[lengthSym], tinyLengthBase[lengthSym]);

      const distSym = tinyDecodeSymbol(d, dt);
      if (distSym < 0 || distSym >= 30) return TINF_DATA_ERROR;
      const dist = tinyReadBits(d, tinyDistBits[distSym], tinyDistBase[distSym]);
      if (dist <= 0) return TINF_DATA_ERROR;
      if (dist > d.destLen) return TINF_DATA_ERROR;

      if (d.destLen + length > d.dest.length) return TINF_DATA_ERROR;
      let off = d.destLen - dist;
      while (length--) d.dest[d.destLen++] = d.dest[off++];
    }
  }

  function inflateRawTiny(sourceBytes, expectedSize) {
    const src = sourceBytes instanceof Uint8Array ? sourceBytes : new Uint8Array(sourceBytes || []);
    const hint = Number(expectedSize);
    const estimated = Number.isFinite(hint) && hint >= 0 ? Math.max(1, hint) : Math.max(1024, src.length * 3);
    let dest = new Uint8Array(estimated);
    let d = new TinyData(src, dest);

    let res = TINF_OK;
    let bfinal = 0;
    do {
      bfinal = tinyGetBit(d);
      const btype = tinyReadBits(d, 2, 0);
      switch (btype) {
        case 0:
          res = tinyInflateUncompressedBlock(d);
          break;
        case 1:
          res = tinyInflateBlockData(d, tinyFixedLTree, tinyFixedDTree);
          break;
        case 2:
          tinyDecodeTrees(d, d.ltree, d.dtree);
          res = tinyInflateBlockData(d, d.ltree, d.dtree);
          break;
        default:
          res = TINF_DATA_ERROR;
      }

      if (res !== TINF_OK) throw new Error("zip deflate data error");

      if (d.destLen === d.dest.length && !bfinal) {
        // Grow destination buffer in-place for huge entries.
        const grown = new Uint8Array(d.dest.length * 2);
        grown.set(d.dest, 0);
        dest = grown;
        d.dest = dest;
      }
    } while (!bfinal);

    if (d.destLen < d.dest.length) return d.dest.subarray(0, d.destLen);
    return d.dest;
  }

  // Initialize tiny-inflate tables once.
  tinyBuildFixedTrees(tinyFixedLTree, tinyFixedDTree);
  tinyBuildBitsBase(tinyLengthBits, tinyLengthBase, 4, 3);
  tinyBuildBitsBase(tinyDistBits, tinyDistBase, 2, 1);
  tinyLengthBits[28] = 0;
  tinyLengthBase[28] = 258;

  function findEocdOffset(bytes) {
    const maxComment = 0xffff;
    const minEocd = 22;
    const maxScan = Math.max(0, bytes.length - minEocd - maxComment);
    for (let i = bytes.length - minEocd; i >= maxScan; i -= 1) {
      if (uint32At(bytes, i) === SIG_END_OF_CENTRAL_DIR) return i;
    }
    return -1;
  }

  async function extractZipEntries(blobOrArrayBuffer) {
    const bytes = await toUint8Array(blobOrArrayBuffer);
    if (bytes.length < 22) throw new Error("zip too small");

    const eocdOff = findEocdOffset(bytes);
    if (eocdOff < 0) throw new Error("zip missing end of central directory");

    const diskNo = uint16At(bytes, eocdOff + 4);
    const diskCd = uint16At(bytes, eocdOff + 6);
    if (diskNo !== 0 || diskCd !== 0) throw new Error("zip multi-disk not supported");

    const entryCount = uint16At(bytes, eocdOff + 10);
    const totalEntries = uint16At(bytes, eocdOff + 8);
    if (entryCount !== totalEntries) throw new Error("zip inconsistent central directory");

    const centralDirSize = uint32At(bytes, eocdOff + 12);
    const centralDirOff = uint32At(bytes, eocdOff + 16);

    if (entryCount === 0xffff || centralDirSize === 0xffffffff || centralDirOff === 0xffffffff) {
      throw new Error("zip64 not supported");
    }

    if (centralDirOff + centralDirSize > bytes.length) throw new Error("zip central directory out of range");

    const out = new Map();
    const decoder = new TextDecoder("utf-8");

    let off = centralDirOff;
    for (let i = 0; i < entryCount; i += 1) {
      if (off + 46 > bytes.length) throw new Error("zip central directory truncated");
      if (uint32At(bytes, off) !== SIG_CENTRAL_DIR_FILE_HEADER) throw new Error("zip invalid central directory header");

      const flags = uint16At(bytes, off + 8);
      const method = uint16At(bytes, off + 10);
      const hash = uint32At(bytes, off + 16);
      const compSize = uint32At(bytes, off + 20);
      const size = uint32At(bytes, off + 24);
      const nameLen = uint16At(bytes, off + 28);
      const extraLen = uint16At(bytes, off + 30);
      const commentLen = uint16At(bytes, off + 32);
      const localOff = uint32At(bytes, off + 42);

      const nameStart = off + 46;
      const nameEnd = nameStart + nameLen;
      if (nameEnd > bytes.length) throw new Error("zip invalid entry name length");

      const rawName = decoder.decode(bytes.subarray(nameStart, nameEnd));
      const name = String(rawName || "").replace(/\\/g, "/");
      if (isUnsafeZipEntryName(name)) throw new Error("zip contains unsafe entry name");
      if (name.endsWith("/")) {
        off = nameEnd + extraLen + commentLen;
        continue;
      }
      if (out.has(name)) throw new Error("zip contains duplicate entry");

      if ((flags & 0x1) !== 0) throw new Error("zip encryption not supported");
      if (method !== 0 && method !== 8) throw new Error("zip compression method not supported");

      if (localOff + 30 > bytes.length) throw new Error("zip local header out of range");
      if (uint32At(bytes, localOff) !== SIG_LOCAL_FILE_HEADER) throw new Error("zip invalid local file header");
      const localNameLen = uint16At(bytes, localOff + 26);
      const localExtraLen = uint16At(bytes, localOff + 28);
      const dataStart = localOff + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compSize;
      if (dataEnd > bytes.length) throw new Error("zip entry data out of range");

      const compressed = bytes.subarray(dataStart, dataEnd);
      let contentBytes;
      if (method === 0) {
        contentBytes = new Uint8Array(compressed);
      } else {
        contentBytes = await decompressDeflateRaw(compressed, size);
      }
      if (Number.isFinite(size) && size >= 0 && contentBytes.length !== size) {
        throw new Error("zip entry size mismatch");
      }
      const actualCrc = crc32(contentBytes);
      if (actualCrc !== hash) throw new Error("zip entry CRC mismatch");

      out.set(name, contentBytes);
      off = nameEnd + extraLen + commentLen;
    }

    return out;
  }

  async function createZipBlob(files) {
    const list = Array.isArray(files) ? files : [];
    if (!list.length) throw new Error("no files to zip");

    const normalized = [];
    for (let i = 0; i < list.length; i += 1) {
      const f = list[i] || {};
      const name = normalizeEntryName(f.name, `file-${i + 1}.txt`);
      const data = await toUint8Array(f.data);
      const at = f.lastModifiedAt ? new Date(f.lastModifiedAt) : new Date();
      normalized.push({ name, data, at });
    }

    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const f of normalized) {
      const nameBytes = new TextEncoder().encode(f.name);
      const dataBytes = f.data;
      const size = dataBytes.length >>> 0;
      const hash = crc32(dataBytes);
      const { dosDate, dosTime } = toDosDateTime(f.at);

      const localHeader = concatBytes([
        uint32LE(0x04034b50),
        uint16LE(20),
        uint16LE(0),
        uint16LE(0),
        uint16LE(dosTime),
        uint16LE(dosDate),
        uint32LE(hash),
        uint32LE(size),
        uint32LE(size),
        uint16LE(nameBytes.length),
        uint16LE(0),
        nameBytes
      ]);

      localChunks.push(localHeader, dataBytes);

      const centralHeader = concatBytes([
        uint32LE(0x02014b50),
        uint16LE(20),
        uint16LE(20),
        uint16LE(0),
        uint16LE(0),
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
        nameBytes
      ]);
      centralChunks.push(centralHeader);

      offset += localHeader.length + dataBytes.length;
    }

    const centralDir = concatBytes(centralChunks);
    const localPart = concatBytes(localChunks);
    const endRecord = concatBytes([
      uint32LE(0x06054b50),
      uint16LE(0),
      uint16LE(0),
      uint16LE(normalized.length),
      uint16LE(normalized.length),
      uint32LE(centralDir.length),
      uint32LE(localPart.length),
      uint16LE(0)
    ]);

    const zipBytes = concatBytes([localPart, centralDir, endRecord]);
    return new Blob([zipBytes], { type: "application/zip" });
  }

  const api = { createZipBlob, extractZipEntries };
  NS.zipUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
