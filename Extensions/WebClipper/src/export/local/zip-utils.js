(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

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

  const api = { createZipBlob };
  NS.zipUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
