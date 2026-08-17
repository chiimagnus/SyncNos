import { unzipSync, zipSync, type ZipOptions, type Zippable } from 'fflate';

import { LocalDataContractError, MAX_ZIP_STREAM_BYTES } from '@services/local-data/contracts';

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const ZIP_CENTRAL_FILE_MIN_BYTES = 46;
const ZIP_MAX_ENTRY_COUNT = 250_000;

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

export function isUnsafeZipEntryName(name: unknown) {
  const text = String(name || '');
  if (!text) return true;
  if (text.includes('\0')) return true;
  if (text.startsWith('/') || text.startsWith('\\')) return true;
  if (/(^|[\\/])\.\.([\\/]|$)/.test(text)) return true;
  return false;
}

function zipToUint8Array(data: Zippable, opts: ZipOptions): Uint8Array {
  // IMPORTANT:
  // - Firefox extension pages enforce a strict CSP that blocks `blob:` workers by default.
  // - `fflate.zip()` transparently switches to async `deflate()` (workerized) for large files,
  //   which then fails under that CSP and can leave the callback unresolved.
  // - `zipSync()` avoids workers entirely and is therefore CSP-safe across browsers.
  return zipSync(data, opts);
}

function zipPayloadTooLarge(actualBytes: number): never {
  throw new LocalDataContractError('PAYLOAD_TOO_LARGE', {
    actualBytes,
    declaredBytes: actualBytes,
    limitBytes: MAX_ZIP_STREAM_BYTES,
    operation: 'zip-backup',
  });
}

function invalidZip(message: string): never {
  throw new Error(`Invalid ZIP: ${message}`);
}

function assertBoundedZipCentralDirectory(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_ZIP_STREAM_BYTES) zipPayloadTooLarge(bytes.byteLength);
  if (bytes.byteLength < ZIP_EOCD_MIN_BYTES) invalidZip('missing end-of-central-directory record');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumOffset = Math.max(0, bytes.byteLength - ZIP_EOCD_MIN_BYTES - ZIP_MAX_COMMENT_BYTES);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - ZIP_EOCD_MIN_BYTES; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength !== bytes.byteLength) continue;
    eocdOffset = offset;
    break;
  }
  if (eocdOffset < 0) invalidZip('missing end-of-central-directory record');

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries)
    invalidZip('multi-disk archives are unsupported');
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    invalidZip('ZIP64 archives are unsupported for bounded backups');
  }
  if (totalEntries > ZIP_MAX_ENTRY_COUNT) invalidZip('too many entries');
  if (centralOffset + centralSize !== eocdOffset || centralOffset > eocdOffset)
    invalidZip('invalid central directory bounds');

  let cursor = centralOffset;
  let parsedEntries = 0;
  let totalUncompressedBytes = 0;
  while (cursor < eocdOffset) {
    if (
      cursor + ZIP_CENTRAL_FILE_MIN_BYTES > eocdOffset ||
      view.getUint32(cursor, true) !== ZIP_CENTRAL_FILE_SIGNATURE
    ) {
      invalidZip('invalid central directory entry');
    }
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      invalidZip('ZIP64 entries are unsupported for bounded backups');
    }
    if (diskStart !== 0) invalidZip('multi-disk entries are unsupported');
    totalUncompressedBytes += uncompressedSize;
    if (uncompressedSize > MAX_ZIP_STREAM_BYTES || totalUncompressedBytes > MAX_ZIP_STREAM_BYTES) {
      zipPayloadTooLarge(totalUncompressedBytes);
    }
    const next = cursor + ZIP_CENTRAL_FILE_MIN_BYTES + nameLength + extraLength + commentLength;
    if (next <= cursor || next > eocdOffset) invalidZip('invalid central directory entry bounds');
    cursor = next;
    parsedEntries += 1;
    if (parsedEntries > ZIP_MAX_ENTRY_COUNT) invalidZip('too many entries');
  }
  if (cursor !== eocdOffset || parsedEntries !== totalEntries) invalidZip('central directory entry count mismatch');
}

function normalizeRezippedTopLevelFolder(entries: Map<string, Uint8Array>): Map<string, Uint8Array> {
  // User-facing resilience: some zip tools add a top-level folder when re-zipping extracted backups
  // (e.g. `SyncNos-Backup-xxxx/manifest.json`). Backup import expects `manifest.json` at the root.
  if (entries.has('manifest.json')) return entries;

  const manifestCandidates: string[] = [];
  for (const name of entries.keys()) {
    if (!name.endsWith('/manifest.json')) continue;
    if (name.indexOf('/') <= 0) continue;
    manifestCandidates.push(name);
  }
  if (!manifestCandidates.length) return entries;

  manifestCandidates.sort((a, b) => {
    const aDepth = a.split('/').length;
    const bDepth = b.split('/').length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.length - b.length;
  });

  const chosen = manifestCandidates[0]!;
  const prefix = chosen.slice(0, chosen.length - 'manifest.json'.length);
  if (!prefix || !prefix.endsWith('/')) return entries;

  const normalized = new Map<string, Uint8Array>();
  for (const [name, fileBytes] of entries.entries()) {
    if (name.startsWith(prefix)) {
      const stripped = name.slice(prefix.length);
      if (!stripped) continue;
      if (isUnsafeZipEntryName(stripped)) throw new Error('Invalid ZIP: unsafe entry name');
      normalized.set(stripped, fileBytes);
      continue;
    }
    if (!normalized.has(name)) normalized.set(name, fileBytes);
  }

  return normalized.has('manifest.json') ? normalized : entries;
}

export type ZipInputEntry = {
  name: string;
  data: unknown;
  lastModified?: unknown;
};

export async function createZipBlob(entries: ZipInputEntry[]): Promise<Blob> {
  const normalized = Array.isArray(entries) ? entries : [];
  const zippable: Zippable = {};

  for (let i = 0; i < normalized.length; i += 1) {
    const entry = normalized[i] || ({} as any);
    const name = normalizeEntryName(entry.name, `file-${i + 1}.txt`);
    const dataBytes = await toUint8Array(entry.data);

    const mtime = entry.lastModified != null ? (entry.lastModified as any) : undefined;
    if (mtime != null) {
      zippable[name] = [dataBytes, { mtime }];
    } else {
      zippable[name] = dataBytes;
    }
  }

  const zipBytes = zipToUint8Array(zippable, { level: 9, mem: 8 });
  return new Blob([new Uint8Array(zipBytes)], { type: 'application/zip' });
}

export async function extractZipEntries(blob: Blob): Promise<Map<string, Uint8Array>> {
  const inputBlob = blob instanceof Blob ? blob : new Blob([]);
  if (inputBlob.size > MAX_ZIP_STREAM_BYTES) zipPayloadTooLarge(inputBlob.size);
  const ab = await inputBlob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  assertBoundedZipCentralDirectory(bytes);

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e || 'unknown');
    throw new Error(`Invalid ZIP: ${msg}`);
  }

  const entries = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(unzipped || {})) {
    if (!name) continue;
    if (name.endsWith('/')) continue;
    if (isUnsafeZipEntryName(name)) throw new Error('Invalid ZIP: unsafe entry name');
    entries.set(name, data);
  }

  return normalizeRezippedTopLevelFolder(entries);
}
