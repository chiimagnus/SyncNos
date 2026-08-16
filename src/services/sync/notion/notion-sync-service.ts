import { optionNameForSource as defaultOptionNameForSource } from '@services/sync/notion/notion-ai.ts';
import { notionFetch as defaultNotionFetch } from '@services/sync/notion/notion-api.ts';
import notionImageUploadUpgrader from '@services/sync/notion/notion-image-upload-upgrader.ts';
import type { ImageAsset } from '@services/conversations/data/image-storage';
import notionMarkdownBlocks from '@services/sync/notion/notion-markdown-blocks.ts';

const MAX_TEXT = 1900;
const APPEND_BATCH = 90;
const APPEND_MAX_ATTEMPTS = 5;
const CLEAR_DELETE_CONCURRENCY = 6;
const CLEAR_DELETE_MAX_ATTEMPTS = 5;

function getNotionFetch() {
  return defaultNotionFetch;
}

function aiLabelForSource(source: unknown): string {
  return defaultOptionNameForSource(source);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeBlockList(blocks: unknown): any[] {
  if (!Array.isArray(blocks)) return [];
  return Array.from(blocks).filter((block) => block && typeof block === 'object');
}

function parseHttpStatus(error: unknown): number {
  const raw = error && (error as any).status != null ? Number((error as any).status) : NaN;
  if (Number.isFinite(raw) && raw > 0) return raw;
  const message = error && (error as any).message ? String((error as any).message) : String(error || '');
  const m = message.match(/\bHTTP\s+(\d{3})\b/i);
  return m ? Number(m[1]) : 0;
}

function normalizeNotionId(id: unknown): string {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '');
}

function retryDelayMs(error: unknown, attempt: unknown): number {
  const retryAfterMs = error && (error as any).retryAfterMs != null ? Number((error as any).retryAfterMs) : 0;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(5000, Math.max(150, Math.round(retryAfterMs)));
  }
  const a = Number.isFinite(Number(attempt)) ? Math.max(1, Number(attempt)) : 1;
  const base = 180 * 2 ** (a - 1);
  const jitter = Math.floor(Math.random() * 120);
  return Math.min(5000, base + jitter);
}

function splitText(text: unknown): string[] {
  const s = String(text || '');
  if (s.length <= MAX_TEXT) return [s];
  const parts: string[] = [];
  let remaining = s;
  while (remaining.length) {
    if (remaining.length <= MAX_TEXT) {
      parts.push(remaining);
      break;
    }
    let idx = remaining.lastIndexOf('\n', MAX_TEXT);
    if (idx < 0) idx = MAX_TEXT;
    parts.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx).replace(/^\n+/, '');
  }
  return parts;
}

function textBlock(content: string) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content } }],
    },
  };
}

function headingBlock(label: string, color?: string) {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [{ type: 'text', text: { content: label } }],
      color: color || 'default',
    },
  };
}

let markdownBlocksApi: any = null;
let imageUploadUpgraderApi: any = null;

function getMarkdownBlocksApi() {
  if (markdownBlocksApi) return markdownBlocksApi;
  if (
    notionMarkdownBlocks &&
    typeof notionMarkdownBlocks.inlineMarkdownToRichText === 'function' &&
    typeof notionMarkdownBlocks.markdownToNotionBlocks === 'function'
  ) {
    markdownBlocksApi = notionMarkdownBlocks;
    return markdownBlocksApi;
  }
  return null;
}

function getImageUploadUpgraderApi() {
  if (imageUploadUpgraderApi) return imageUploadUpgraderApi;
  if (notionImageUploadUpgrader && typeof notionImageUploadUpgrader.upgradeImageBlocksToFileUploads === 'function') {
    imageUploadUpgraderApi = notionImageUploadUpgrader;
    return imageUploadUpgraderApi;
  }
  return null;
}

function inlineMarkdownToRichText(markdown: unknown, base: any = {}, link?: unknown) {
  const api = getMarkdownBlocksApi();
  if (api && typeof api.inlineMarkdownToRichText === 'function') {
    return api.inlineMarkdownToRichText(markdown, base, link);
  }
  const content = String(markdown || '');
  if (!content) return [];
  return [{ type: 'text', text: { content }, annotations: { ...base } }];
}

function markdownToNotionBlocks(markdown: unknown) {
  const api = getMarkdownBlocksApi();
  if (api && typeof api.markdownToNotionBlocks === 'function') {
    return api.markdownToNotionBlocks(markdown);
  }
  const content = String(markdown || '').trim();
  if (!content) return [];
  return [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content } }] },
    },
  ];
}

function messagesToBlocks(messages: any, _options?: unknown) {
  const out = [];
  for (const m of messages || []) {
    const role = m.role || 'assistant';
    const authorName = m && m.authorName && String(m.authorName).trim() ? String(m.authorName).trim() : 'You';
    const label = role === 'user' ? authorName : role === 'assistant' ? 'Assistant' : role;
    out.push(headingBlock(label, role === 'user' ? 'green' : 'blue_background'));
    const markdown = m && m.contentMarkdown && String(m.contentMarkdown).trim() ? String(m.contentMarkdown) : '';
    if (markdown) {
      const blocks = markdownToNotionBlocks(markdown);
      if (blocks.length) out.push(...blocks);
      else {
        const parts = splitText(m.contentText || '');
        for (const p of parts) out.push(textBlock(p));
      }
    } else {
      const parts = splitText(m.contentText || '');
      for (const p of parts) out.push(textBlock(p));
    }
  }
  return out;
}

async function listChildren(accessToken: string, blockId: string) {
  const notionFetch = getNotionFetch();
  const out: any[] = [];
  let cursor: string | null = null;
  for (;;) {
    const qs = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(String(cursor))}` : '?page_size=100';

    const res = await notionFetch({
      accessToken,
      method: 'GET',
      path: `/v1/blocks/${blockId}/children${qs}`,
    });
    const results = Array.isArray(res && res.results) ? res.results : [];
    out.push(...results);
    if (!res || !res.has_more) break;
    cursor = res.next_cursor || null;
    if (!cursor) break;
  }
  return out;
}

async function archiveBlock(accessToken: string, blockId: string) {
  const notionFetch = getNotionFetch();
  // Notion uses DELETE to archive blocks.
  return notionFetch({ accessToken, method: 'DELETE', path: `/v1/blocks/${blockId}` });
}

async function archiveBlockWithRetry(accessToken: string, blockId: string) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await archiveBlock(accessToken, blockId);
    } catch (error) {
      const status = parseHttpStatus(error);
      const retryable = status === 429 || status === 503;
      if (!retryable || attempt >= CLEAR_DELETE_MAX_ATTEMPTS) throw error;

      await sleep(retryDelayMs(error, attempt));
    }
  }
}

async function appendBatchWithRetry(accessToken: string, pageId: string, batch: unknown) {
  const children = normalizeBlockList(batch);
  if (!children.length) return {};
  const notionFetch = getNotionFetch();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await notionFetch({
        accessToken,
        method: 'PATCH',
        path: `/v1/blocks/${pageId}/children`,
        body: { children },
      });
    } catch (error) {
      const status = parseHttpStatus(error);
      const retryable = status === 429 || status === 503;
      if (!retryable || attempt >= APPEND_MAX_ATTEMPTS) throw error;

      await sleep(retryDelayMs(error, attempt));
    }
  }
}

async function parallelEach(items: unknown, worker: (item: any) => unknown, concurrency?: unknown) {
  const queue = Array.isArray(items) ? items.slice() : [];
  if (!queue.length) return true;
  const size = Number.isFinite(Number(concurrency)) ? Math.max(1, Number(concurrency)) : 1;
  const workers = [];
  for (let i = 0; i < size; i += 1) {
    workers.push(
      (async () => {
        for (;;) {
          const item = queue.shift();
          if (item == null) return;

          await worker(item);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return true;
}

async function clearPageChildren(accessToken: string, pageId: string) {
  const children = await listChildren(accessToken, pageId);
  const ids = children.map((c) => (c && c.id ? String(c.id).trim() : '')).filter(Boolean);
  await parallelEach(
    ids,
    async (blockId) => {
      await archiveBlockWithRetry(accessToken, blockId);
    },
    CLEAR_DELETE_CONCURRENCY,
  );
}

async function appendChildren(accessToken: string, pageId: string, blocks: unknown) {
  let remaining = normalizeBlockList(blocks);
  const appended = [];
  while (remaining.length) {
    const batch = remaining.slice(0, APPEND_BATCH);
    remaining = remaining.slice(APPEND_BATCH);
    const res = await appendBatchWithRetry(accessToken, pageId, batch);
    const results = Array.isArray(res && res.results) ? res.results : [];
    if (results.length) appended.push(...results);
  }
  return { results: appended, count: appended.length };
}

function buildPageProperties({
  title,
  url,
  ai,
  includeDate,
  capturedAt,
}: {
  title?: string;
  url?: string;
  ai?: unknown;
  includeDate?: boolean;
  capturedAt?: unknown;
}) {
  function coerceHttpUrlOrNull(input: unknown): string | null {
    const raw = String(input ?? '').trim();
    if (!raw) return null;
    try {
      const parsed = new URL(raw);
      const protocol = String(parsed.protocol || '').toLowerCase();
      if (protocol !== 'http:' && protocol !== 'https:') return null;
      return raw;
    } catch (_e) {
      return null;
    }
  }

  const props: Record<string, any> = {
    Name: { title: [{ type: 'text', text: { content: title || 'Untitled' } }] },
    // Notion rejects empty string for URL properties; use null when missing/invalid.
    URL: { url: coerceHttpUrlOrNull(url) },
  };
  if (includeDate) {
    const at = Number(capturedAt);
    const stamp = Number.isFinite(at) && at > 0 ? at : Date.now();
    props.Date = { date: { start: new Date(stamp).toISOString() } };
  }
  const aiName = aiLabelForSource(ai);
  if (aiName) props.AI = { multi_select: [{ name: aiName }] };
  return props;
}

function resolveProperties({
  properties,
  title,
  url,
  ai,
  includeDate,
  capturedAt,
}: {
  properties?: any;
  title?: string;
  url?: string;
  ai?: unknown;
  includeDate?: boolean;
  capturedAt?: unknown;
}) {
  if (properties && typeof properties === 'object') return properties;
  return buildPageProperties({ title, url, ai, includeDate, capturedAt });
}

async function createPageInDatabase(
  accessToken: string,
  {
    databaseId,
    title,
    url,
    ai,
    properties,
    capturedAt,
  }: { databaseId?: string; title?: string; url?: string; ai?: unknown; properties?: any; capturedAt?: unknown },
) {
  const notionFetch = getNotionFetch();
  const body = {
    parent: { database_id: databaseId },
    properties: resolveProperties({ properties, title, url, ai, includeDate: true, capturedAt }),
  };
  return notionFetch({ accessToken, method: 'POST', path: '/v1/pages', body });
}

async function updatePageProperties(
  accessToken: string,
  {
    pageId,
    title,
    url,
    ai,
    properties,
  }: { pageId?: string; title?: string; url?: string; ai?: unknown; properties?: any },
) {
  const notionFetch = getNotionFetch();
  const body = {
    properties: resolveProperties({ properties, title, url, ai, includeDate: false }),
  };
  return notionFetch({ accessToken, method: 'PATCH', path: `/v1/pages/${pageId}`, body });
}

async function getPage(accessToken: string, pageId: string) {
  const notionFetch = getNotionFetch();
  return notionFetch({ accessToken, method: 'GET', path: `/v1/pages/${pageId}` });
}

function isPageArchivedOrTrashed(page: any): boolean {
  try {
    if (!page || typeof page !== 'object') return true;
    if (page.archived === true) return true;
    if (page.in_trash === true) return true;
    return false;
  } catch (_e) {
    return true;
  }
}

function isPageUsableForDatabase(page: any, databaseId: unknown): boolean {
  if (!pageBelongsToDatabase(page, databaseId)) return false;
  if (isPageArchivedOrTrashed(page)) return false;
  return true;
}

function pageBelongsToDatabase(page: any, databaseId: unknown): boolean {
  try {
    const parent = page && page.parent ? page.parent : null;
    if (!parent || parent.type !== 'database_id') return false;
    const actual = normalizeNotionId(parent.database_id);
    const expected = normalizeNotionId(databaseId);
    if (!actual || !expected) return false;
    return actual === expected;
  } catch (_e) {
    return false;
  }
}

function hasExternalImageBlocks(blocks: unknown): boolean {
  const list = Array.isArray(blocks) ? blocks : [];
  return list.some(
    (b) =>
      b && b.type === 'image' && b.image && b.image.type === 'external' && b.image.external && b.image.external.url,
  );
}

async function upgradeImageBlocksToFileUploads(
  accessToken: string,
  blocks: unknown,
  resolveImageAsset: (assetId: number) => Promise<ImageAsset | null>,
) {
  const api = getImageUploadUpgraderApi();
  if (api && typeof api.upgradeImageBlocksToFileUploads === 'function') {
    return api.upgradeImageBlocksToFileUploads(accessToken, blocks, resolveImageAsset);
  }
  return Array.isArray(blocks) ? blocks : [];
}

const api = {
  messagesToBlocks,
  markdownToNotionBlocks,
  inlineMarkdownToRichText,
  clearPageChildren,
  appendChildren,
  createPageInDatabase,
  updatePageProperties,
  getPage,
  isPageArchivedOrTrashed,
  isPageUsableForDatabase,
  pageBelongsToDatabase,
  hasExternalImageBlocks,
  upgradeImageBlocksToFileUploads,
  aiLabelForSource,
};

export {
  messagesToBlocks,
  markdownToNotionBlocks,
  inlineMarkdownToRichText,
  clearPageChildren,
  appendChildren,
  createPageInDatabase,
  updatePageProperties,
  getPage,
  isPageArchivedOrTrashed,
  isPageUsableForDatabase,
  pageBelongsToDatabase,
  hasExternalImageBlocks,
  upgradeImageBlocksToFileUploads,
  aiLabelForSource,
};
export default api;
