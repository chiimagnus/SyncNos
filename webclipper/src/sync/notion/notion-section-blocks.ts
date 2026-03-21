import { notionFetch } from './notion-api';

export type ToggleHeadingLevel = 1 | 2 | 3;

export const SYNCNOS_NOTION_SECTION_TITLES = {
  article: 'Article',
  comments: 'Comments',
} as const;

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function isArchivedBlock(block: any): boolean {
  try {
    return (block as any)?.archived === true || (block as any)?.in_trash === true;
  } catch (_e) {
    return false;
  }
}

function readPlainTextFromRichText(items: unknown): string {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const plain = (item as any).plain_text;
      if (plain != null) return String(plain);
      const content = (item as any)?.text?.content;
      if (content != null) return String(content);
      return '';
    })
    .join('');
}

function headingTypeForLevel(level: ToggleHeadingLevel): 'heading_1' | 'heading_2' | 'heading_3' {
  if (level === 1) return 'heading_1';
  if (level === 2) return 'heading_2';
  return 'heading_3';
}

export function buildToggleHeadingBlock(title: string, level: ToggleHeadingLevel = 2) {
  const resolvedTitle = safeString(title);
  const type = headingTypeForLevel(level);
  const rich_text = [{ type: 'text', text: { content: resolvedTitle || 'Untitled' } }];
  return {
    object: 'block',
    type,
    [type]: {
      rich_text,
      is_toggleable: true,
    },
  } as any;
}

export async function listBlockChildren(accessToken: string, blockId: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | null = null;
  for (;;) {
    const qs = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(String(cursor))}` : '?page_size=100';
    // eslint-disable-next-line no-await-in-loop
    const res = await notionFetch({ accessToken, method: 'GET', path: `/v1/blocks/${blockId}/children${qs}` } as any);
    const results = Array.isArray((res as any)?.results) ? (res as any).results : [];
    out.push(...results);
    if (!(res as any)?.has_more) break;
    cursor = (res as any)?.next_cursor ? String((res as any).next_cursor) : null;
    if (!cursor) break;
  }
  return out;
}

function isToggleHeadingBlock(block: any): boolean {
  if (isArchivedBlock(block)) return false;
  const type = safeString(block?.type);
  if (type !== 'heading_1' && type !== 'heading_2' && type !== 'heading_3') return false;
  const payload = (block as any)?.[type];
  return !!payload && (payload as any).is_toggleable === true;
}

function toggleHeadingTitle(block: any): string {
  const type = safeString(block?.type);
  const payload = type ? (block as any)?.[type] : null;
  return readPlainTextFromRichText(payload?.rich_text);
}

export function findToggleHeadingBlock(children: any[], title: string): any | null {
  const list = Array.isArray(children) ? children : [];
  const needle = safeString(title);
  if (!needle) return null;
  for (const block of list) {
    if (!block || typeof block !== 'object') continue;
    if (!isToggleHeadingBlock(block)) continue;
    if (toggleHeadingTitle(block) === needle) return block;
  }
  return null;
}

export async function findOrCreateToggleHeadingBlockId(args: {
  accessToken: string;
  pageId: string;
  title: string;
  level?: ToggleHeadingLevel;
  appendChildren: (accessToken: string, blockId: string, blocks: any[]) => Promise<any>;
  preferredBlockId?: string | null;
}): Promise<{ blockId: string; created: boolean }> {
  const accessToken = safeString(args.accessToken);
  const pageId = safeString(args.pageId);
  const title = safeString(args.title);
  if (!accessToken) throw new Error('missing notion accessToken');
  if (!pageId) throw new Error('missing notion pageId');
  if (!title) throw new Error('missing section title');

  const children = await listBlockChildren(accessToken, pageId);
  const preferred = safeString(args.preferredBlockId);
  if (preferred) {
    const existingPreferred = children.find((b) => b && typeof b === 'object' && safeString((b as any).id) === preferred);
    if (existingPreferred && isToggleHeadingBlock(existingPreferred) && toggleHeadingTitle(existingPreferred) === title) {
      return { blockId: preferred, created: false };
    }
  }

  const existing = findToggleHeadingBlock(children, title);
  if (existing && existing.id) return { blockId: safeString(existing.id), created: false };

  const next = buildToggleHeadingBlock(title, args.level || 2);
  await args.appendChildren(accessToken, pageId, [next]);

  const refreshed = await listBlockChildren(accessToken, pageId);
  const created = findToggleHeadingBlock(refreshed, title);
  const createdId = safeString(created?.id);
  if (!createdId) throw new Error(`failed to create notion section "${title}"`);
  return { blockId: createdId, created: true };
}
