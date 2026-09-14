import { openDb } from '@platform/idb/schema';
import { downloadImageSmart } from '@platform/webext/image-download-proxy';
import { reusableImageCacheByteSize } from '@services/conversations/data/image-cache-record';
import { chatgptFileIdFromUrl } from '@services/shared/chatgpt-image-identity';
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
    if (!isDataImageUrl(url) && !isHttpUrl(url) && !chatgptFileIdFromUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    output.push(url);
  }
  return output;
}

export function hasCacheableChatImageReference(markdown: unknown): boolean {
  return collectInlineCandidateUrls(collectMarkdownImageReferences(markdown)).length > 0;
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

type DeferredImageDownloadResult =
  | { cacheKey: string; ok: true; blob: Blob; byteSize: number; contentType: string }
  | { cacheKey: string; ok: false; reason?: string };

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
  messages: any[];
  onlyMessageKeys?: Set<string> | null;
  enableHttpImages?: boolean;
  enableChatgptImages?: boolean;
  downloadChatgptImages?: (fileIds: string[]) => Promise<DeferredImageDownloadResult[]>;
}): Promise<InlineChatImagesResult> {
  const conversationId = Number(input.conversationId);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const onlyKeys = input.onlyMessageKeys || null;
  const enableHttpImages = input.enableHttpImages !== false;
  const enableChatgptImages = input.enableChatgptImages === true;

  const parsedMessages: Array<{
    message: any;
    markdown: string;
    references: MarkdownImageReference[];
    urls: string[];
  }> = [];
  const dataDescriptorByUrl = new Map<string, DataImageDescriptor>();
  const chatgptUrls: string[] = [];
  const seenChatgptUrls = new Set<string>();
  const cacheLookupUrls: string[] = [];
  const seenCacheLookupUrls = new Set<string>();
  const addCacheLookupUrl = (url: string) => {
    if (!url || seenCacheLookupUrls.has(url)) return;
    seenCacheLookupUrls.add(url);
    cacheLookupUrls.push(url);
  };

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
      const isChatgptImage = !isDataUrl && !!chatgptFileIdFromUrl(url);
      const isHttpImage = !isDataUrl && !isChatgptImage && isHttpUrl(url);
      if (isHttpImage && !enableHttpImages) continue;
      if (isChatgptImage && !enableChatgptImages) continue;
      if (!isDataUrl && !isHttpImage && !isChatgptImage) continue;

      if (isDataUrl) {
        if (!dataDescriptorByUrl.has(url)) {
          dataDescriptorByUrl.set(url, describeDataImageUrl({ dataUrl: url, maxBytes: NO_IMAGE_SIZE_LIMIT }));
        }
        const descriptor = dataDescriptorByUrl.get(url)!;
        if (!descriptor.ok) continue;
        addCacheLookupUrl(descriptor.cacheKey);
        addCacheLookupUrl(url);
        continue;
      }

      addCacheLookupUrl(url);
      if (isChatgptImage && !seenChatgptUrls.has(url)) {
        seenChatgptUrls.add(url);
        chatgptUrls.push(url);
      }
    }
  }

  const cachedByUrl = await getCachedImagesByUrls(conversationId, cacheLookupUrls);
  const replacements = new Map<string, string>();
  const warningFlags = new Set<string>();
  let inlinedCount = 0;
  let fromCacheCount = 0;
  let downloadedCount = 0;
  let inlinedBytes = 0;

  const chatgptAssetByUrl = new Map<string, CachedAsset>();
  const chatgptCacheHitUrls = new Set<string>();
  const chatgptMissUrls: string[] = [];
  for (const url of chatgptUrls) {
    const cached = cachedByUrl.get(url);
    if (cached) {
      try {
        const asset = await ensureCachedAssetRecord(cached);
        if (asset) {
          chatgptAssetByUrl.set(url, asset);
          chatgptCacheHitUrls.add(url);
          continue;
        }
      } catch (_error) {
        // Corrupt cache rows are ordinary misses and are retried through the source below.
      }
    }
    chatgptMissUrls.push(url);
  }

  if (chatgptMissUrls.length) {
    const fileIds = chatgptMissUrls.map(chatgptFileIdFromUrl).filter(Boolean);
    let downloadedByKey = new Map<string, DeferredImageDownloadResult>();
    if (fileIds.length && input.downloadChatgptImages) {
      try {
        const downloaded = await input.downloadChatgptImages(fileIds);
        downloadedByKey = new Map(
          (Array.isArray(downloaded) ? downloaded : [])
            .filter((item) => item && typeof item.cacheKey === 'string')
            .map((item) => [item.cacheKey, item]),
        );
      } catch (_error) {
        downloadedByKey = new Map();
      }
    }

    for (const url of chatgptMissUrls) {
      const downloaded = downloadedByKey.get(url);
      if (!downloaded?.ok) {
        warningFlags.add('chatgpt_images_cache_incomplete');
        continue;
      }
      try {
        const asset = await upsertCachedImageAsset({
          conversationId,
          url,
          blob: downloaded.blob,
          byteSize: downloaded.byteSize,
          contentType: downloaded.contentType,
        });
        chatgptAssetByUrl.set(url, asset);
        downloadedCount += 1;
      } catch (_error) {
        warningFlags.add('chatgpt_images_cache_incomplete');
      }
    }
  }

  for (const parsedMessage of parsedMessages) {
    const { message, markdown, references, urls } = parsedMessage;
    if (!urls.length) continue;

    for (const url of urls) {
      if (replacements.has(url)) continue;
      const isDataUrl = isDataImageUrl(url);
      const isChatgptImage = !isDataUrl && !!chatgptFileIdFromUrl(url);
      const isHttpImage = !isDataUrl && !isChatgptImage && isHttpUrl(url);
      if (isHttpImage && !enableHttpImages) continue;
      if (isChatgptImage && !enableChatgptImages) continue;
      if (!isDataUrl && !isHttpImage && !isChatgptImage) continue;

      if (isChatgptImage) {
        const asset = chatgptAssetByUrl.get(url);
        if (!asset) {
          warningFlags.add('chatgpt_images_cache_incomplete');
          continue;
        }
        replacements.set(url, formatSyncnosAssetUrl(asset.id));
        if (chatgptCacheHitUrls.has(url)) fromCacheCount += 1;
        inlinedCount += 1;
        inlinedBytes += asset.byteSize;
        continue;
      }

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
        const downloaded = await downloadImageAsBlob({ url, maxBytes: NO_IMAGE_SIZE_LIMIT });
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

  return {
    messages,
    inlinedCount,
    fromCacheCount,
    downloadedCount,
    inlinedBytes,
    warningFlags: Array.from(warningFlags),
  };
}
