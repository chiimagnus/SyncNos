import { notionFetch } from '@services/sync/notion/notion-api.ts';
import { upgradeImageBlocksToFileUploads } from '@services/sync/notion/notion-image-upload-upgrader.ts';
import { markdownToNotionBlocks } from '@services/sync/notion/notion-markdown-blocks.ts';

const APPEND_BATCH = 90;
const APPEND_MAX_ATTEMPTS = 5;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeNotionId(id: unknown): string {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '');
}

function retryDelayMs(error: unknown, attempt: number): number {
  const retryAfterMs = error && (error as any).retryAfterMs != null ? Number((error as any).retryAfterMs) : 0;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(5000, Math.max(150, Math.round(retryAfterMs)));
  }
  const base = 180 * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 120);
  return Math.min(5000, base + jitter);
}

function headingBlock(label: string, color: string) {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [{ type: 'text', text: { content: label } }],
      color,
    },
  };
}

function messagesToBlocks(messages: any[]) {
  const out = [];
  for (const m of messages) {
    const role = m.role || 'assistant';
    const authorName = m.authorName && String(m.authorName).trim() ? String(m.authorName).trim() : 'You';
    const label = role === 'user' ? authorName : role === 'assistant' ? 'Assistant' : role;
    out.push(headingBlock(label, role === 'user' ? 'green' : 'blue_background'));
    const markdown = String(m.contentMarkdown || '');
    if (!markdown.trim()) continue;
    out.push(...markdownToNotionBlocks(markdown));
  }
  return out;
}

async function appendBatchWithRetry(accessToken: string, pageId: string, children: any[]) {
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
      const status = Number((error as any)?.status || 0);
      const retryable = status === 429 || status === 503;
      if (!retryable || attempt >= APPEND_MAX_ATTEMPTS) throw error;

      await sleep(retryDelayMs(error, attempt));
    }
  }
}

async function appendChildren(accessToken: string, pageId: string, blocks: any[]) {
  const appended = [];
  for (let start = 0; start < blocks.length; start += APPEND_BATCH) {
    const res = await appendBatchWithRetry(accessToken, pageId, blocks.slice(start, start + APPEND_BATCH));
    const results = Array.isArray(res && res.results) ? res.results : [];
    if (results.length) appended.push(...results);
  }
  return { results: appended, count: appended.length };
}

function requireExplicitProperties(properties: unknown): Record<string, unknown> {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error('notion page properties required');
  }
  return properties as Record<string, unknown>;
}

async function createPageInDatabase(
  accessToken: string,
  { databaseId, properties }: { databaseId: string; properties: Record<string, unknown> },
) {
  const body = {
    parent: { database_id: databaseId },
    properties: requireExplicitProperties(properties),
  };
  return notionFetch({ accessToken, method: 'POST', path: '/v1/pages', body });
}

async function updatePageProperties(
  accessToken: string,
  { pageId, properties }: { pageId: string; properties: Record<string, unknown> },
) {
  const body = { properties: requireExplicitProperties(properties) };
  return notionFetch({ accessToken, method: 'PATCH', path: `/v1/pages/${pageId}`, body });
}

async function getPage(accessToken: string, pageId: string) {
  return notionFetch({ accessToken, method: 'GET', path: `/v1/pages/${pageId}` });
}

function isPageUsableForDatabase(page: any, databaseId: string): boolean {
  if (!page || typeof page !== 'object' || page.archived === true || page.in_trash === true) return false;
  const parent = page.parent;
  if (!parent || parent.type !== 'database_id') return false;
  const actual = normalizeNotionId(parent.database_id);
  const expected = normalizeNotionId(databaseId);
  return Boolean(actual && expected && actual === expected);
}

export {
  messagesToBlocks,
  appendChildren,
  createPageInDatabase,
  updatePageProperties,
  getPage,
  isPageUsableForDatabase,
  upgradeImageBlocksToFileUploads,
};
