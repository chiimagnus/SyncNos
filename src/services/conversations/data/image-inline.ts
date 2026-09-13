import { openDb } from '@platform/idb/schema';
import { downloadImageSmart } from '@platform/webext/image-download-proxy';
import { reusableImageCacheByteSize } from '@services/conversations/data/image-cache-record';
import { runTrackedTransaction } from '@services/data-revisions/transaction';
import {
  collectMarkdownImageReferences,
  replaceMarkdownImageReferences,
  type MarkdownImageReference,
} from '@services/shared/markdown-image-references';
import { formatSyncnosAssetUrl } from '@services/shared/syncnos-asset-uri';

const NO_IMAGE_SIZE_LIMIT = Number.POSITIVE_INFINITY;

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

function collectInlineCandidateUrls(references: readonly MarkdownImageReference[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const reference of references) {
    const url = reference.target;
    if (!isDataImageUrl(url) && !isHttpUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    output.push(url);
  }
  return output;
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

type DataImageFailure = { ok: false; reason: 'non_image' | 'empty' | 'too_large' | 'fetch' };
type DataImageDescriptor = { ok: true; byteSize: number; contentType: string; cacheKey: string } | DataImageFailure;
type DecodedDataImage =
  | { ok: true; bytes: Uint8Array; byteSize: number; contentType: string; cacheKey: string }
  | DataImageFailure;

function decodeDataImageUrl(input: { dataUrl: string; maxBytes: number }): DecodedDataImage {
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
  return { ok: true, bytes, byteSize, contentType, cacheKey };
}

function describeDataImageUrl(input: { dataUrl: string; maxBytes: number }): DataImageDescriptor {
  const decoded = decodeDataImageUrl(input);
  if (!decoded.ok) return decoded;
  return {
    ok: true,
    byteSize: decoded.byteSize,
    contentType: decoded.contentType,
    cacheKey: decoded.cacheKey,
  };
}

function parseDataImageUrl(input: {
  dataUrl: string;
  maxBytes: number;
}): { ok: true; blob: Blob; byteSize: number; contentType: string; cacheKey: string } | DataImageFailure {
  const decoded = decodeDataImageUrl(input);
  if (!decoded.ok) return decoded;
  return {
    ok: true,
    blob: new Blob([Uint8Array.from(decoded.bytes)], { type: decoded.contentType }),
    byteSize: decoded.byteSize,
    contentType: decoded.contentType,
    cacheKey: decoded.cacheKey,
  };
}

async function getCachedImagesByUrls(
  conversationId: number,
  urls: readonly string[],
): Promise<Map<string, ImageCacheRow>> {
  if (!urls.length) return new Map();

  const db = await openDb();
  const { t, stores } = tx(db, ['image_cache'], 'readonly');
  const done = txDone(t);
  const idx = stores.image_cache.index('by_conversationId_url');
  const requests = urls.map((url) =>
    reqToPromise(idx.get([conversationId, url]) as IDBRequest<ImageCacheRow | undefined>).then(
      (row) => [url, row] as const,
    ),
  );
  const [rows] = await Promise.all([Promise.all(requests), done]);

  const cached = new Map<string, ImageCacheRow>();
  for (const [url, row] of rows) {
    if (row) cached.set(url, row);
  }
  return cached;
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

  const byteSize = Number(input.byteSize) || input.blob.size || 0;
  const contentType = parseContentType(input.contentType || input.blob.type);
  const dataUrl = String(input.dataUrl || '').trim();
  const db = await openDb();

  return runTrackedTransaction(
    { db, stores: ['image_cache'], revisionScopes: ['image_cache'] },
    async ({ stores, markChanged }) => {
      const idx = stores.image_cache.index('by_conversationId_url');
      const existing = (await reqToPromise(idx.get([input.conversationId, safeUrl]) as any)) as
        | ImageCacheRow
        | undefined;
      const existingByteSize = reusableImageCacheByteSize(existing);
      if (existing && existingByteSize > 0) {
        const existingId = Number(existing.id);
        if (!Number.isFinite(existingId) || existingId <= 0) throw new Error('invalid image cache id');
        return { id: existingId, byteSize: existingByteSize };
      }

      const now = Date.now();
      const existingId = Number(existing?.id);
      const record: ImageCacheRow = {
        ...(Number.isFinite(existingId) && existingId > 0 ? { id: existingId } : {}),
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
      markChanged('image_cache');
      const nextId = Number(putResult ?? existingId);
      if (!Number.isFinite(nextId) || nextId <= 0) throw new Error('invalid image cache id');
      return { id: nextId, byteSize };
    },
  );
}

async function ensureCachedAssetRecord(row: ImageCacheRow): Promise<CachedAsset | null> {
  const id = Number(row?.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const reusableByteSize = reusableImageCacheByteSize(row);
  if (reusableByteSize > 0) return { id, byteSize: reusableByteSize };

  if (!row.dataUrl || !isDataImageUrl(row.dataUrl)) return null;
  const parsed = parseDataImageUrl({ dataUrl: row.dataUrl, maxBytes: NO_IMAGE_SIZE_LIMIT });
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
  maxBytes: number;
}): Promise<
  | { ok: true; blob: Blob; byteSize: number; contentType: string }
  | { ok: false; reason: 'http' | 'non_image' | 'empty' | 'too_large' | 'fetch' }
> {
  const safeUrl = String(input.url || '').trim();
  if (!isHttpUrl(safeUrl)) return { ok: false, reason: 'fetch' };
  try {
    const result = await downloadImageSmart({ url: safeUrl, maxBytes: input.maxBytes });
    if (result.ok) return result;
    return { ok: false, reason: result.reason === 'invalid_input' ? 'fetch' : result.reason };
  } catch (_error) {
    return { ok: false, reason: 'fetch' };
  }
}

export type ProtectedImageCandidate = {
  ref: string;
  cacheKey: string;
  targetMessageKey: string;
  alt?: string;
  [key: string]: unknown;
};

export type ProtectedImageDownloadResult =
  | { cacheKey: string; ok: true; blob: Blob; byteSize: number; contentType: string }
  | { cacheKey: string; ok: false; reason?: string };

export type ProtectedImageBundle = {
  assets: ProtectedImageCandidate[];
  [key: string]: unknown;
};

export type InlineChatImagesResult = {
  messages: any[];
  inlinedCount: number;
  fromCacheCount: number;
  downloadedCount: number;
  inlinedBytes: number;
  warningFlags: string[];
};

function safeImageAlt(value: unknown): string {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/]/g, '\\]')
    .trim()
    .slice(0, 200);
}

function appendMarkdownBlock(markdown: unknown, block: string): string {
  const base = String(markdown || '').trimEnd();
  if (!block || base.includes(block)) return base;
  return base ? `${base}\n\n${block}` : block;
}

function markProtectedImageFailure(message: any, alt: unknown): void {
  const safeAlt = safeImageAlt(alt);
  message.contentMarkdown = appendMarkdownBlock(message.contentMarkdown, safeAlt ? `[image: ${safeAlt}]` : '[image]');
  if (message.captureMergePolicy !== 'preserve-existing-content') {
    message.captureMergePolicy = 'preserve-existing-markdown';
  }
}

export async function inlineChatImagesInMessages(input: {
  conversationId: number;
  messages: any[];
  onlyMessageKeys?: Set<string> | null;
  enableHttpImages?: boolean;
  protectedImages?: ProtectedImageBundle | null;
  downloadProtectedImages?: (bundle: ProtectedImageBundle) => Promise<ProtectedImageDownloadResult[]>;
}): Promise<InlineChatImagesResult> {
  const conversationId = Number(input.conversationId);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const onlyKeys = input.onlyMessageKeys || null;
  const enableHttpImages = input.enableHttpImages !== false;
  const protectedAssets = Array.isArray(input.protectedImages?.assets) ? input.protectedImages!.assets : [];
  const messagesByKey = new Map<string, any>();
  for (const message of messages) {
    const key = String(message?.messageKey || '').trim();
    if (key) messagesByKey.set(key, message);
  }
  for (const asset of protectedAssets) {
    if (!asset?.targetMessageKey || !messagesByKey.has(String(asset.targetMessageKey))) {
      throw new Error('protected image target message is missing');
    }
  }

  const parsedMessages: Array<{
    message: any;
    markdown: string;
    references: MarkdownImageReference[];
    urls: string[];
  }> = [];
  const dataDescriptorByUrl = new Map<string, DataImageDescriptor>();
  const cacheLookupUrls: string[] = [];
  const seenCacheLookupUrls = new Set<string>();
  const addCacheLookupUrl = (url: string) => {
    if (!url || seenCacheLookupUrls.has(url)) return;
    seenCacheLookupUrls.add(url);
    cacheLookupUrls.push(url);
  };

  for (const asset of protectedAssets) {
    const cacheKey = String(asset?.cacheKey || '').trim();
    if (cacheKey) addCacheLookupUrl(cacheKey);
  }

  for (const msg of messages) {
    if (!msg || !msg.messageKey) continue;
    if (onlyKeys && !onlyKeys.has(String(msg.messageKey))) continue;
    const markdown = msg.contentMarkdown && String(msg.contentMarkdown).trim() ? String(msg.contentMarkdown) : '';
    if (!markdown) continue;

    const references = collectMarkdownImageReferences(markdown);
    const urls = collectInlineCandidateUrls(references);
    parsedMessages.push({ message: msg, markdown, references, urls });
    for (const url of urls) {
      const isDataUrl = isDataImageUrl(url);
      const isHttpImage = !isDataUrl && isHttpUrl(url);
      if (!isDataUrl && !isHttpImage) continue;
      if (isHttpImage && !enableHttpImages) continue;
      if (isDataUrl) {
        if (!dataDescriptorByUrl.has(url)) {
          dataDescriptorByUrl.set(url, describeDataImageUrl({ dataUrl: url, maxBytes: NO_IMAGE_SIZE_LIMIT }));
        }
        const descriptor = dataDescriptorByUrl.get(url)!;
        if (!descriptor.ok) continue;
        addCacheLookupUrl(descriptor.cacheKey);
        addCacheLookupUrl(url);
      } else {
        addCacheLookupUrl(url);
      }
    }
  }

  let cacheLookupFailed = false;
  let cachedByUrl: Map<string, ImageCacheRow>;
  try {
    cachedByUrl = await getCachedImagesByUrls(conversationId, cacheLookupUrls);
  } catch (error) {
    if (!protectedAssets.length) throw error;
    cacheLookupFailed = true;
    cachedByUrl = new Map();
  }
  const replacements = new Map<string, string>();
  const warningFlags = new Set<string>();
  let inlinedCount = 0;
  let fromCacheCount = 0;
  let downloadedCount = 0;
  let inlinedBytes = 0;

  for (const parsedMessage of parsedMessages) {
    const { message, markdown, references, urls } = parsedMessage;
    if (!urls.length) continue;

    for (const url of urls) {
      if (replacements.has(url)) continue;
      const isDataUrl = isDataImageUrl(url);
      const isHttpImage = !isDataUrl && isHttpUrl(url);
      if (!isDataUrl && !isHttpImage) continue;
      if (isHttpImage && !enableHttpImages) continue;

      let cacheLookupUrl = url;
      if (isDataUrl) {
        const descriptor =
          dataDescriptorByUrl.get(url) || describeDataImageUrl({ dataUrl: url, maxBytes: NO_IMAGE_SIZE_LIMIT });
        if (!descriptor.ok) {
          warningFlags.add('inline_images_download_failed');
          continue;
        }
        cacheLookupUrl = descriptor.cacheKey;
      }

      if (cacheLookupFailed) {
        warningFlags.add('inline_images_download_failed');
        continue;
      }
      const cached = cachedByUrl.get(cacheLookupUrl) || (isDataUrl ? cachedByUrl.get(url) : undefined);
      if (cached) {
        try {
          const cachedAsset = await ensureCachedAssetRecord(cached);
          if (cachedAsset) {
            replacements.set(url, formatSyncnosAssetUrl(cachedAsset.id));
            fromCacheCount += 1;
            inlinedCount += 1;
            inlinedBytes += cachedAsset.byteSize;
            continue;
          }
        } catch (_error) {
          // Treat a corrupt/unreadable cache row as a miss and retry the source once below.
        }
      }

      let nextAsset: CachedAsset | null = null;
      if (isDataUrl) {
        // ponytail: 预扫描只保留 cacheKey；cache miss 在原处理位置二次解码，避免整批 Blob 常驻。只有 profiling 证明 CPU 成本更高时才缓存解码结果。
        const parsed = parseDataImageUrl({ dataUrl: url, maxBytes: NO_IMAGE_SIZE_LIMIT });
        if (!parsed.ok) {
          warningFlags.add('inline_images_download_failed');
          continue;
        }

        try {
          nextAsset = await upsertCachedImageAsset({
            conversationId,
            url: parsed.cacheKey,
            blob: parsed.blob,
            byteSize: parsed.byteSize,
            contentType: parsed.contentType,
          });
        } catch (_error) {
          warningFlags.add('inline_images_download_failed');
          continue;
        }
      } else {
        const downloaded = await downloadImageAsBlob({
          url,
          maxBytes: NO_IMAGE_SIZE_LIMIT,
        });
        if (!downloaded.ok) {
          warningFlags.add('inline_images_download_failed');
          continue;
        }

        try {
          nextAsset = await upsertCachedImageAsset({
            conversationId,
            url,
            blob: downloaded.blob,
            byteSize: downloaded.byteSize,
            contentType: downloaded.contentType,
          });
        } catch (_error) {
          warningFlags.add('inline_images_download_failed');
          continue;
        }
      }

      replacements.set(url, formatSyncnosAssetUrl(nextAsset.id));
      downloadedCount += 1;
      inlinedCount += 1;
      inlinedBytes += nextAsset.byteSize;
    }

    if (!replacements.size) continue;
    const nextMarkdown = replaceMarkdownImageReferences(markdown, references, (reference) => {
      const next = replacements.get(reference.target);
      return next ? { target: next } : null;
    });
    if (nextMarkdown !== markdown) message.contentMarkdown = nextMarkdown;
  }

  if (protectedAssets.length) {
    const misses: ProtectedImageCandidate[] = [];
    const cachedAssetByKey = new Map<string, CachedAsset>();
    if (!cacheLookupFailed) {
      for (const asset of protectedAssets) {
        const cacheKey = String(asset.cacheKey || '').trim();
        if (!cacheKey) continue;
        const cached = cachedByUrl.get(cacheKey);
        if (!cached) {
          misses.push(asset);
          continue;
        }
        try {
          const cachedAsset = await ensureCachedAssetRecord(cached);
          if (cachedAsset) cachedAssetByKey.set(cacheKey, cachedAsset);
          else misses.push(asset);
        } catch (_error) {
          misses.push(asset);
        }
      }
    }

    let downloadedByKey = new Map<string, ProtectedImageDownloadResult>();
    if (!cacheLookupFailed && misses.length && input.downloadProtectedImages) {
      try {
        const downloaded = await input.downloadProtectedImages({ ...(input.protectedImages || {}), assets: misses });
        downloadedByKey = new Map(
          (Array.isArray(downloaded) ? downloaded : [])
            .filter((item) => item && typeof item.cacheKey === 'string')
            .map((item) => [item.cacheKey, item]),
        );
      } catch (_error) {
        downloadedByKey = new Map();
      }
    }

    for (const asset of protectedAssets) {
      const message = messagesByKey.get(String(asset.targetMessageKey));
      const cacheKey = String(asset.cacheKey || '').trim();
      let cachedAsset = cacheKey ? cachedAssetByKey.get(cacheKey) || null : null;
      let downloaded = cacheKey ? downloadedByKey.get(cacheKey) : undefined;

      if (!cachedAsset && downloaded?.ok) {
        try {
          cachedAsset = await upsertCachedImageAsset({
            conversationId,
            url: cacheKey,
            blob: downloaded.blob,
            byteSize: downloaded.byteSize,
            contentType: downloaded.contentType,
          });
          downloadedCount += 1;
        } catch (_error) {
          cachedAsset = null;
        }
      }

      if (!cachedAsset) {
        warningFlags.add('protected_images_incomplete');
        markProtectedImageFailure(message, asset.alt);
        continue;
      }

      const localUrl = formatSyncnosAssetUrl(cachedAsset.id);
      const alt = safeImageAlt(asset.alt);
      message.contentMarkdown = appendMarkdownBlock(message.contentMarkdown, `![${alt}](${localUrl})`);
      if (cachedAssetByKey.has(cacheKey)) fromCacheCount += 1;
      inlinedCount += 1;
      inlinedBytes += cachedAsset.byteSize;
    }
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
