import { unzipSync, zipSync, type ZipOptions, type Zippable } from 'fflate';

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

function zipToUint8Array(data: Zippable, opts: ZipOptions): Uint8Array {
  // IMPORTANT:
  // - Firefox extension pages enforce a strict CSP that blocks `blob:` workers by default.
  // - `fflate.zip()` transparently switches to async `deflate()` (workerized) for large files,
  //   which then fails under that CSP and can leave the callback unresolved.
  // - `zipSync()` avoids workers entirely and is therefore CSP-safe across browsers.
  return zipSync(data, opts);
}

type ZipInputEntry = {
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

  return entries;
}
