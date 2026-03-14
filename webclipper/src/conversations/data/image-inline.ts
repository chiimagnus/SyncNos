import { openDb as openSchemaDb } from '../../platform/idb/schema';

const INLINE_HTTP_IMAGES_MAX_COUNT = 12;
const INLINE_HTTP_IMAGE_MAX_BYTES = 2_000_000;
const INLINE_HTTP_IMAGES_MAX_TOTAL_BYTES = 8_000_000;

type ImageCacheRow = {
  id?: number;
  conversationId: number;
  url: string;
  dataUrl: string;
  byteSize: number;
  contentType: string;
  createdAt: number;
  updatedAt: number;
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

function stripAngleBrackets(url: string): string {
  const text = String(url || '').trim();
  if (text.startsWith('<') && text.endsWith('>')) return text.slice(1, -1).trim();
  return text;
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;

function extractHttpImageUrlsFromMarkdown(markdown: string): string[] {
  const raw = String(markdown || '');
  if (!raw) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = MARKDOWN_IMAGE_RE.exec(raw)) != null) {
    const urlPart = match[2] ? String(match[2]) : '';
    const url = stripAngleBrackets(urlPart);
    if (!isHttpUrl(url) || isDataImageUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    output.push(url);
  }
  return output;
}

function replaceMarkdownImageUrls(markdown: string, replacements: Map<string, string>): string {
  if (!replacements.size) return markdown;
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function getCachedDataUrl(conversationId: number, url: string): Promise<ImageCacheRow | null> {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) return null;
  const db = await openDb();
  const { t, stores } = tx(db, ['image_cache'], 'readonly');
  const idx = stores.image_cache.index('by_conversationId_url');
  const row = (await reqToPromise(idx.get([conversationId, safeUrl]) as any)) as ImageCacheRow | undefined;
  await txDone(t);
  return row || null;
}

async function upsertCachedDataUrl(input: {
  conversationId: number;
  url: string;
  dataUrl: string;
  byteSize: number;
  contentType: string;
}): Promise<void> {
  const safeUrl = String(input.url || '').trim();
  const safeDataUrl = String(input.dataUrl || '').trim();
  if (!safeUrl || !safeDataUrl) return;

  const db = await openDb();
  const { t, stores } = tx(db, ['image_cache'], 'readwrite');
  const idx = stores.image_cache.index('by_conversationId_url');

  const existing = (await reqToPromise(idx.get([input.conversationId, safeUrl]) as any)) as ImageCacheRow | undefined;
  const now = Date.now();
  const record: ImageCacheRow = {
    ...(existing && existing.id ? { id: existing.id } : {}),
    conversationId: input.conversationId,
    url: safeUrl,
    dataUrl: safeDataUrl,
    byteSize: Number(input.byteSize) || 0,
    contentType: String(input.contentType || '').trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await reqToPromise(stores.image_cache.put(record as any));
  await txDone(t);
}

async function downloadImageAsDataUrl(input: {
  url: string;
  referrer?: string;
  maxBytes: number;
}): Promise<{ dataUrl: string; byteSize: number; contentType: string } | null> {
  const safeUrl = String(input.url || '').trim();
  if (!isHttpUrl(safeUrl)) return null;

  const referrer = isHttpUrl(input.referrer) ? String(input.referrer) : undefined;
  const res = await fetch(safeUrl, {
    method: 'GET',
    credentials: 'include',
    redirect: 'follow',
    ...(referrer ? { referrer } : {}),
  });
  if (!res.ok) return null;

  const contentType = parseContentType(res.headers.get('content-type'));
  if (!contentType.startsWith('image/')) return null;

  const buffer = await res.arrayBuffer();
  const byteSize = buffer.byteLength || 0;
  if (!byteSize) return null;
  if (byteSize > input.maxBytes) return null;

  const base64 = arrayBufferToBase64(buffer);
  if (!base64) return null;

  return { dataUrl: `data:${contentType};base64,${base64}`, byteSize, contentType };
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
}): Promise<InlineChatImagesResult> {
  const conversationId = Number(input.conversationId);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const onlyKeys = input.onlyMessageKeys || null;

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

    const urls = extractHttpImageUrlsFromMarkdown(markdown);
    if (!urls.length) continue;

    for (const url of urls) {
      if (replacements.has(url)) continue;

      if (inlinedCount >= INLINE_HTTP_IMAGES_MAX_COUNT) {
        warningFlags.add('inline_images_count_limit_reached');
        continue;
      }
      if (inlinedBytes >= INLINE_HTTP_IMAGES_MAX_TOTAL_BYTES) {
        warningFlags.add('inline_images_total_bytes_limit_reached');
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const cached = await getCachedDataUrl(conversationId, url);
      if (cached && cached.dataUrl && isDataImageUrl(cached.dataUrl)) {
        replacements.set(url, cached.dataUrl);
        fromCacheCount += 1;
        inlinedCount += 1;
        inlinedBytes += Number(cached.byteSize) || 0;
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const downloaded = await downloadImageAsDataUrl({
        url,
        referrer: input.conversationUrl,
        maxBytes: INLINE_HTTP_IMAGE_MAX_BYTES,
      });
      if (!downloaded) {
        warningFlags.add('inline_images_download_failed');
        continue;
      }
      if ((inlinedBytes + downloaded.byteSize) > INLINE_HTTP_IMAGES_MAX_TOTAL_BYTES) {
        warningFlags.add('inline_images_total_bytes_limit_reached');
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await upsertCachedDataUrl({
        conversationId,
        url,
        dataUrl: downloaded.dataUrl,
        byteSize: downloaded.byteSize,
        contentType: downloaded.contentType,
      });

      replacements.set(url, downloaded.dataUrl);
      downloadedCount += 1;
      inlinedCount += 1;
      inlinedBytes += downloaded.byteSize;
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
