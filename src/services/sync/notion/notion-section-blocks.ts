import { notionFetch } from '@services/sync/notion/notion-api';

type ToggleHeadingLevel = 1 | 2 | 3;

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function isArchivedBlock(block: any): boolean {
  return block?.archived === true || block?.in_trash === true;
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

function isHeadingType(type: unknown): type is 'heading_1' | 'heading_2' | 'heading_3' {
  const t = safeString(type);
  return t === 'heading_1' || t === 'heading_2' || t === 'heading_3';
}

export function buildToggleHeadingBlock(title: string, level: ToggleHeadingLevel) {
  const type = headingTypeForLevel(level);
  const rich_text = [{ type: 'text', text: { content: safeString(title) } }];
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

    const res = await notionFetch({ accessToken, method: 'GET', path: `/v1/blocks/${blockId}/children${qs}` });
    const results = Array.isArray(res?.results) ? res.results : [];
    out.push(...results);
    if (!res?.has_more) break;
    cursor = res?.next_cursor ? String(res.next_cursor) : null;
    if (!cursor) break;
  }
  return out;
}

export async function retrieveBlock(accessToken: string, blockId: string): Promise<any> {
  const id = safeString(blockId);
  if (!id) throw new Error('missing blockId');
  return notionFetch({ accessToken, method: 'GET', path: `/v1/blocks/${encodeURIComponent(id)}` });
}

export async function archiveBlock(accessToken: string, blockId: string): Promise<any> {
  const id = safeString(blockId);
  if (!id) throw new Error('missing blockId');
  // Notion uses DELETE to archive blocks.
  return notionFetch({ accessToken, method: 'DELETE', path: `/v1/blocks/${id}` });
}

export function isToggleHeadingBlock(block: any): boolean {
  if (isArchivedBlock(block)) return false;
  const type = safeString(block?.type);
  if (!isHeadingType(type)) return false;
  const payload = (block as any)?.[type];
  if (!payload) return false;
  return (payload as any).is_toggleable === true;
}

function toggleHeadingTitle(block: any): string {
  const type = safeString(block?.type);
  const payload = type ? (block as any)?.[type] : null;
  return readPlainTextFromRichText(payload?.rich_text);
}

function isHeadingBlock(block: any): boolean {
  if (isArchivedBlock(block)) return false;
  const type = safeString(block?.type);
  if (!isHeadingType(type)) return false;
  const payload = (block as any)?.[type];
  return !!payload;
}

export function findHeadingBlocksByTitle(children: any[], title: string): any[] {
  const needle = safeString(title);
  if (!needle) return [];
  const out: any[] = [];
  for (const block of children) {
    if (!block || typeof block !== 'object') continue;
    if (!isHeadingBlock(block)) continue;
    if (toggleHeadingTitle(block) !== needle) continue;
    out.push(block);
  }
  return out;
}
