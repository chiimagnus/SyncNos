// @ts-nocheck
import { getPageTitle, notionFetch as defaultNotionFetch } from '@services/sync/notion/notion-api.ts';

export type NotionParentPageOption = { id: string; title: string };

type NotionFetch = typeof defaultNotionFetch;

function normalizeId(id: unknown) {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '');
}

function isPageArchived(page: any) {
  return page?.archived === true || page?.in_trash === true;
}

function isSearchUsableParentPage(item: any) {
  if (!item || item.object !== 'page') return false;
  if (isPageArchived(item)) return false;
  const parent = item.parent || null;
  if (!parent) return true;
  if (parent.database_id) return false;
  if (parent.type === 'database_id') return false;
  return true;
}

function toOption(page: any): NotionParentPageOption | null {
  const id = String(page?.id || '').trim();
  if (!id) return null;
  return { id, title: String(getPageTitle(page) || '').trim() || id };
}

function dedupeOptions(list: NotionParentPageOption[]) {
  const out: NotionParentPageOption[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(list) ? list : []) {
    const id = normalizeId(item?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id: String(item.id || '').trim(), title: String(item.title || '').trim() || String(item.id || '') });
  }
  return out;
}

async function searchParentPagesOnce(
  notionFetch: NotionFetch,
  accessToken: string,
  input: { pageSize: number; startCursor?: string | null },
) {
  const body: any = {
    filter: { property: 'object', value: 'page' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
    page_size: input.pageSize,
  };
  if (input.startCursor) body.start_cursor = String(input.startCursor);
  const res = await notionFetch({ accessToken, method: 'POST', path: '/v1/search', body });
  const results = Array.isArray(res?.results) ? res.results : [];
  const pages = results.filter(isSearchUsableParentPage);
  return {
    pages,
    allResults: results,
    hasMore: !!res?.has_more,
    nextCursor: res?.next_cursor ? String(res.next_cursor) : '',
  };
}

async function retrievePage(notionFetch: NotionFetch, accessToken: string, pageId: string) {
  const safeId = String(pageId || '').trim();
  if (!safeId) return null;
  try {
    const page = await notionFetch({
      accessToken,
      method: 'GET',
      path: `/v1/pages/${encodeURIComponent(safeId)}`,
    });
    if (!page || page.object !== 'page') return null;
    if (isPageArchived(page)) return null;
    return page;
  } catch (_e) {
    return null;
  }
}

export async function listNotionParentPages(
  accessToken: string,
  {
    savedPageId,
    pageSize = 50,
    maxPages = 20,
    notionFetchImpl = defaultNotionFetch,
  }: { savedPageId?: string; pageSize?: number; maxPages?: number; notionFetchImpl?: NotionFetch } = {},
): Promise<{ pages: NotionParentPageOption[]; resolvedSaved: NotionParentPageOption | null }> {
  const token = String(accessToken || '').trim();
  if (!token) throw new Error('missing notion access token');

  const savedNorm = normalizeId(savedPageId);
  let cursor: string | null = null;
  let guard = 0;
  let foundPages: any[] = [];
  let resolvedSaved: any = null;

  while (guard < maxPages) {
    guard += 1;
    const { pages, allResults, hasMore, nextCursor } = await searchParentPagesOnce(notionFetchImpl, token, {
      pageSize,
      startCursor: cursor,
    });

    if (savedNorm && !resolvedSaved) {
      const hit = allResults.find((p: any) => normalizeId(p?.id) === savedNorm) || null;
      if (hit && hit.object === 'page' && !isPageArchived(hit)) resolvedSaved = hit;
    }

    if (pages.length) {
      foundPages = pages;
      break;
    }
    if (!hasMore || !nextCursor) break;
    cursor = nextCursor;
  }

  if (savedNorm && !resolvedSaved) {
    resolvedSaved = await retrievePage(notionFetchImpl, token, String(savedPageId || '').trim());
  }

  const list = foundPages.map(toOption).filter(Boolean) as NotionParentPageOption[];
  const savedOpt = resolvedSaved ? toOption(resolvedSaved) : null;
  const merged = savedOpt ? [savedOpt, ...list] : list;

  return {
    pages: dedupeOptions(merged),
    resolvedSaved: savedOpt,
  };
}
