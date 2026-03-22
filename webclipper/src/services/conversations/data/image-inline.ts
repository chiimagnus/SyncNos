import { openDb as openSchemaDb } from '@platform/idb/schema';

const INLINE_HTTP_IMAGES_MAX_COUNT = 12;
const INLINE_HTTP_IMAGE_MAX_BYTES = 2_000_000;
const INLINE_HTTP_IMAGES_MAX_TOTAL_BYTES = 8_000_000;
const SYNCNOS_ASSET_PREFIX = 'syncnos-asset://';

type ImageCacheRow = {
  id?: number;
  conversationId: number;
  url: string;
  dataUrl?: string;
  blob?: Blob;
  byteSize: number;
  contentType: string;
  createdAt: number;
  updatedAt: number;
};

type CachedAsset = {
  id: number;
  byteSize: number;
};

let cachedDb: IDBDatabase | null = null;
let openingDb: Promise<IDBDatabase> | null = null;

async function openDb(): Promise<IDBDatabase> {
  if (cachedDb) return cachedDb;
  if (openingDb) return openingDb;
  openingDb = openSchemaDb()
    .then((db) => {
      cachedDb = db;
      return db;
    })
    .finally(() => {
      openingDb = null;
    });
  return openingDb;
}

export async function __closeDbForTests(): Promise<void> {
  try {
    const db = cachedDb || (openingDb ? await openingDb : null);
    db?.close?.();
  } catch (_e) {
    // ignore
  } finally {
    cachedDb = null;
    openingDb = null;
  }
}

function tx(
  db: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
): { t: IDBTransaction; stores: Record<string, IDBObjectStore> } {
  const t = db.transaction(storeNames, mode);
  const stores: Record<string, IDBObjectStore> = {};
  for (const name of storeNames) stores[name] = t.objectStore(name);
  return { t, stores };
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(t: IDBTransaction): Promise<true> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error || new Error('transaction failed'));
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

function isHttpUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  return /^https?:\/\//i.test(text);
}

function isDataImageUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  if (!text) return false;
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?(?:;base64)?,/i.test(text);
}

function isSyncnosAssetUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  if (!text) return false;
  return /^syncnos-asset:\/\/\d+$/i.test(text);
}

function stripAngleBrackets(url: string): string {
  const text = String(url || '').trim();
  if (text.startsWith('<') && text.endsWith('>')) return text.slice(1, -1).trim();
  return text;
}

function toSyncnosAssetUrl(id: number): string {
  return `${SYNCNOS_ASSET_PREFIX}${id}`;
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;

function extractInlineCandidateUrlsFromMarkdown(markdown: string): string[] {
  const raw = String(markdown || '');
  if (!raw) return [];
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  const seen = new Set<string>();
  const output: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = MARKDOWN_IMAGE_RE.exec(raw)) != null) {
    const urlPart = match[2] ? String(match[2]) : '';
    const url = stripAngleBrackets(urlPart);
    if (isSyncnosAssetUrl(url)) continue;
    if (!isDataImageUrl(url) && !isHttpUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    output.push(url);
  }
  return output;
}

function replaceMarkdownImageUrls(markdown: string, replacements: Map<string, string>): string {
  if (!replacements.size) return markdown;
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  return String(markdown || '').replace(MARKDOWN_IMAGE_RE, (_full, altRaw, urlPartRaw, titleRaw) => {
    const alt = altRaw ? String(altRaw) : '';
    const urlPart = urlPartRaw ? String(urlPartRaw) : '';
    const title = titleRaw ? String(titleRaw) : '';
    const url = stripAngleBrackets(urlPart);
    const next = replacements.get(url);
    if (!next) return _full;
    const nextPart = urlPart.trim().startsWith('<') && !isDataImageUrl(next) ? `<${next}>` : next;
    return `![${alt}](${nextPart}${title})`;
  });
}

function parseContentType(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.split(';')[0]!.trim().toLowerCase();
}

function base64ToBytes(base64: string): Uint8Array {
  const normalized = String(base64 || '').replace(/\s+/g, '');
  if (!normalized) return new Uint8Array();

  const atobFn = (globalThis as any).atob as ((input: string) => string) | undefined;
  if (typeof atobFn === 'function') {
    const binary = atobFn(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  const bufferApi = (globalThis as any).Buffer as any;
  if (bufferApi && typeof bufferApi.from === 'function') {
    const nodeBuffer = bufferApi.from(normalized, 'base64');
    return new Uint8Array(nodeBuffer);
  }

  throw new Error('base64 decoder unavailable');
}

function utf8ToBytes(text: string): Uint8Array {
  const encoder = (globalThis as any).TextEncoder as (new () => TextEncoder) | undefined;
  if (encoder) {
    return new encoder().encode(String(text || ''));
  }
  const bufferApi = (globalThis as any).Buffer as any;
  if (bufferApi && typeof bufferApi.from === 'function') {
    const nodeBuffer = bufferApi.from(String(text || ''), 'utf8');
    return new Uint8Array(nodeBuffer);
  }
  const raw = String(text || '');
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i) & 0xff;
  return out;
}

function parseDataImageUrl(input: {
  dataUrl: string;
  maxBytes: number;
}):
  | { ok: true; blob: Blob; byteSize: number; contentType: string; cacheKey: string }
  | { ok: false; reason: 'non_image' | 'empty' | 'too_large' | 'fetch' } {
  const safeDataUrl = String(input.dataUrl || '').trim();
  if (!isDataImageUrl(safeDataUrl)) return { ok: false, reason: 'non_image' };

  const commaAt = safeDataUrl.indexOf(',');
  if (commaAt <= 0) return { ok: false, reason: 'fetch' };

  const meta = safeDataUrl.slice('data:'.length, commaAt).trim();
  const payload = safeDataUrl.slice(commaAt + 1);
  const metaParts = meta
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const contentType = parseContentType(metaParts[0] || '');
  if (!contentType.startsWith('image/')) return { ok: false, reason: 'non_image' };

  const isBase64 = metaParts.some((part) => part.toLowerCase() === 'base64');
  let bytes: Uint8Array;
  try {
    bytes = isBase64 ? base64ToBytes(payload) : utf8ToBytes(decodeURIComponent(payload));
  } catch (_e) {
    return { ok: false, reason: 'fetch' };
  }

  const byteSize = bytes.byteLength || 0;
  if (!byteSize) return { ok: false, reason: 'empty' };
  if (byteSize > input.maxBytes) return { ok: false, reason: 'too_large' };

  // Avoid storing the full `data:` URL as an IndexedDB key/index value.
  // Use a short, content-addressed-ish cache key derived from bytes instead.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  const hashHex = hash.toString(16).padStart(16, '0');
  const cacheKey = `data:${contentType};fnv1a64=${hashHex}`;

  const blob = new Blob([Uint8Array.from(bytes)], { type: contentType });
  return { ok: true, blob, byteSize, contentType, cacheKey };
}

async function getCachedImage(conversationId: number, url: string): Promise<ImageCacheRow | null> {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) return null;
  const db = await openDb();
  const { t, stores } = tx(db, ['image_cache'], 'readonly');
  const idx = stores.image_cache.index('by_conversationId_url');
  const row = (await reqToPromise(idx.get([conversationId, safeUrl]) as any)) as ImageCacheRow | undefined;
  await txDone(t);
  return row || null;
}

async function upsertCachedImageAsset(input: {
  conversationId: number;
  url: string;
  blob: Blob;
  byteSize: number;
  contentType: string;
  dataUrl?: string;
}): Promise<CachedAsset> {
  const safeUrl = String(input.url || '').trim();
  if (!safeUrl) throw new Error('image cache url required');

  const db = await openDb();
  const { t, stores } = tx(db, ['image_cache'], 'readwrite');
  const idx = stores.image_cache.index('by_conversationId_url');

  const existing = (await reqToPromise(idx.get([input.conversationId, safeUrl]) as any)) as ImageCacheRow | undefined;
  const now = Date.now();
  const byteSize = Number(input.byteSize) || input.blob.size || 0;
  const contentType = parseContentType(input.contentType || input.blob.type);
  const dataUrl = String(input.dataUrl || '').trim();
  const record: ImageCacheRow = {
    ...(existing && existing.id ? { id: existing.id } : {}),
    conversationId: input.conversationId,
    url: safeUrl,
    ...(dataUrl ? { dataUrl } : existing?.dataUrl ? { dataUrl: existing.dataUrl } : {}),
    blob: input.blob,
    byteSize,
    contentType,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const putResult = await reqToPromise(stores.image_cache.put(record as any));
  await txDone(t);

  const nextId = Number(putResult ?? existing?.id);
  if (!Number.isFinite(nextId) || nextId <= 0) throw new Error('invalid image cache id');
  return { id: nextId, byteSize };
}

async function ensureCachedAssetRecord(row: ImageCacheRow): Promise<CachedAsset | null> {
  const id = Number(row?.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  if (row.blob instanceof Blob) {
    const byteSize = Number(row.byteSize) || row.blob.size || 0;
    if (byteSize > 0) return { id, byteSize };
  }

  if (!row.dataUrl || !isDataImageUrl(row.dataUrl)) return null;
  const parsed = parseDataImageUrl({ dataUrl: row.dataUrl, maxBytes: INLINE_HTTP_IMAGE_MAX_BYTES });
  if (!parsed.ok) return null;

  return upsertCachedImageAsset({
    conversationId: row.conversationId,
    url: row.url,
    blob: parsed.blob,
    byteSize: parsed.byteSize,
    contentType: parsed.contentType,
    dataUrl: row.dataUrl,
  });
}

async function downloadImageAsBlob(input: {
  url: string;
  referrer?: string;
  maxBytes: number;
}): Promise<
  | { ok: true; blob: Blob; byteSize: number; contentType: string }
  | { ok: false; reason: 'http' | 'non_image' | 'empty' | 'too_large' | 'fetch' }
> {
  const safeUrl = String(input.url || '').trim();
  if (!isHttpUrl(safeUrl)) return { ok: false, reason: 'fetch' };

  const referrer = isHttpUrl(input.referrer) ? String(input.referrer) : undefined;
  try {
    const res = await fetch(safeUrl, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      ...(referrer ? { referrer } : {}),
    });
    if (!res.ok) return { ok: false, reason: 'http' };

    const contentType = parseContentType(res.headers.get('content-type') || '');
    if (!contentType.startsWith('image/')) return { ok: false, reason: 'non_image' };

    const blob = await res.blob();
    const byteSize = blob.size || 0;
    if (!byteSize) return { ok: false, reason: 'empty' };
    if (byteSize > input.maxBytes) return { ok: false, reason: 'too_large' };

    return { ok: true, blob, byteSize, contentType };
  } catch (_e) {
    return { ok: false, reason: 'fetch' };
  }
}

export type InlineChatImagesResult = {
  messages: any[];
  inlinedCount: number;
  fromCacheCount: number;
  downloadedCount: number;
  inlinedBytes: number;
  warningFlags: string[];
};

export async function inlineChatImagesInMessages(input: {
  conversationId: number;
  conversationUrl?: string;
  messages: any[];
  onlyMessageKeys?: Set<string> | null;
  enableHttpImages?: boolean;
}): Promise<InlineChatImagesResult> {
  const conversationId = Number(input.conversationId);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const onlyKeys = input.onlyMessageKeys || null;
  const enableHttpImages = input.enableHttpImages !== false;

  const replacements = new Map<string, string>();
  const warningFlags = new Set<string>();
  let inlinedCount = 0;
  let fromCacheCount = 0;
  let downloadedCount = 0;
  let inlinedBytes = 0;

  for (const msg of messages) {
    if (!msg || !msg.messageKey) continue;
    if (onlyKeys && !onlyKeys.has(String(msg.messageKey))) continue;

    const markdown = msg.contentMarkdown && String(msg.contentMarkdown).trim() ? String(msg.contentMarkdown) : '';
    if (!markdown) continue;

    const urls = extractInlineCandidateUrlsFromMarkdown(markdown);
    if (!urls.length) continue;

    for (const url of urls) {
      if (replacements.has(url)) continue;
      const isDataUrl = isDataImageUrl(url);
      const isHttpImage = !isDataUrl && isHttpUrl(url);
      if (!isDataUrl && !isHttpImage) continue;
      if (isHttpImage && !enableHttpImages) continue;

      if (inlinedCount >= INLINE_HTTP_IMAGES_MAX_COUNT) {
        warningFlags.add('inline_images_count_limit_reached');
        continue;
      }
      if (inlinedBytes >= INLINE_HTTP_IMAGES_MAX_TOTAL_BYTES) {
        warningFlags.add('inline_images_total_bytes_limit_reached');
        continue;
      }

      let parsedDataUrl:
        | { ok: true; blob: Blob; byteSize: number; contentType: string; cacheKey: string }
        | { ok: false; reason: 'non_image' | 'empty' | 'too_large' | 'fetch' }
        | null = null;
      let cacheLookupUrl = url;
      if (isDataUrl) {
        parsedDataUrl = parseDataImageUrl({ dataUrl: url, maxBytes: INLINE_HTTP_IMAGE_MAX_BYTES });
        if (!parsedDataUrl.ok) {
          if (parsedDataUrl.reason === 'too_large') warningFlags.add('inline_images_single_bytes_limit_reached');
          else warningFlags.add('inline_images_download_failed');
          continue;
        }
        if (inlinedBytes + parsedDataUrl.byteSize > INLINE_HTTP_IMAGES_MAX_TOTAL_BYTES) {
          warningFlags.add('inline_images_total_bytes_limit_reached');
          continue;
        }
        cacheLookupUrl = parsedDataUrl.cacheKey;
      }

      const cached =
        (await getCachedImage(conversationId, cacheLookupUrl)) ||
        (isDataUrl ? await getCachedImage(conversationId, url) : null);
      if (cached) {
        const cachedAsset = await ensureCachedAssetRecord(cached);
        if (cachedAsset) {
          replacements.set(url, toSyncnosAssetUrl(cachedAsset.id));
          fromCacheCount += 1;
          inlinedCount += 1;
          inlinedBytes += cachedAsset.byteSize;
          continue;
        }
      }

      let nextAsset: CachedAsset | null = null;
      if (isDataUrl) {
        const parsed = parsedDataUrl && parsedDataUrl.ok ? parsedDataUrl : null;
        if (!parsed) continue;

        nextAsset = await upsertCachedImageAsset({
          conversationId,
          url: parsed.cacheKey,
          blob: parsed.blob,
          byteSize: parsed.byteSize,
          contentType: parsed.contentType,
        });
      } else {
        const downloaded = await downloadImageAsBlob({
          url,
          referrer: input.conversationUrl,
          maxBytes: INLINE_HTTP_IMAGE_MAX_BYTES,
        });
        if (!downloaded.ok) {
          if (downloaded.reason === 'too_large') warningFlags.add('inline_images_single_bytes_limit_reached');
          else warningFlags.add('inline_images_download_failed');
          continue;
        }
        if (inlinedBytes + downloaded.byteSize > INLINE_HTTP_IMAGES_MAX_TOTAL_BYTES) {
          warningFlags.add('inline_images_total_bytes_limit_reached');
          continue;
        }

        nextAsset = await upsertCachedImageAsset({
          conversationId,
          url,
          blob: downloaded.blob,
          byteSize: downloaded.byteSize,
          contentType: downloaded.contentType,
        });
      }

      replacements.set(url, toSyncnosAssetUrl(nextAsset.id));
      downloadedCount += 1;
      inlinedCount += 1;
      inlinedBytes += nextAsset.byteSize;
    }

    if (!replacements.size) continue;
    const nextMarkdown = replaceMarkdownImageUrls(markdown, replacements);
    if (nextMarkdown !== markdown) msg.contentMarkdown = nextMarkdown;
  }

  return {
    messages,
    inlinedCount,
    fromCacheCount,
    downloadedCount,
    inlinedBytes,
    warningFlags: Array.from(warningFlags),
  };
}
