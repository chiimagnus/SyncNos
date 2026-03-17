import { unzipSync, zip, type ZipOptions, type Zippable } from 'fflate';

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

function zipToUint8Array(data: Zippable, opts: ZipOptions): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(data, opts, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
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

  const zipBytes = await zipToUint8Array(zippable, { level: 6 });
  return new Blob([new Uint8Array(zipBytes)], { type: 'application/zip' });
}

export async function extractZipEntries(blob: Blob): Promise<Map<string, Uint8Array>> {
  const inputBlob = blob instanceof Blob ? blob : new Blob([]);
  const ab = await inputBlob.arrayBuffer();
  const bytes = new Uint8Array(ab);

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
