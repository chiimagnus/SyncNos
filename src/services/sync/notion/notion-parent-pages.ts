import { getPageTitle, notionFetch } from '@services/sync/notion/notion-api.ts';

type NotionParentPageOption = { id: string; title: string };

const SEARCH_PAGE_SIZE = 50;

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
  return parent.type !== 'database_id';
}

function toOption(page: any): NotionParentPageOption | null {
  const id = String(page?.id || '').trim();
  if (!id) return null;
  return { id, title: String(getPageTitle(page) || '').trim() || id };
}

function dedupeOptions(list: NotionParentPageOption[]) {
  const out: NotionParentPageOption[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id = normalizeId(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id: item.id.trim(), title: item.title.trim() || item.id });
  }
  return out;
}

async function searchParentPagesOnce(accessToken: string, startCursor: string | null) {
  const body = {
    filter: { property: 'object', value: 'page' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
    page_size: SEARCH_PAGE_SIZE,
    ...(startCursor ? { start_cursor: startCursor } : {}),
  };
  const res = await notionFetch({ accessToken, method: 'POST', path: '/v1/search', body });
  const results = Array.isArray(res?.results) ? res.results : [];
  return {
    pages: results.filter(isSearchUsableParentPage),
    allResults: results,
    hasMore: !!res?.has_more,
    nextCursor: res?.next_cursor ? String(res.next_cursor) : '',
  };
}

async function retrievePage(accessToken: string, pageId: string) {
  const safeId = pageId.trim();
  if (!safeId) return null;
  try {
    const page = await notionFetch({
      accessToken,
      method: 'GET',
      path: `/v1/pages/${encodeURIComponent(safeId)}`,
    });
    if (!page || page.object !== 'page' || isPageArchived(page)) return null;
    return page;
  } catch (_e) {
    return null;
  }
}

export async function listNotionParentPages(
  accessToken: string,
  { savedPageId }: { savedPageId?: string } = {},
): Promise<{ pages: NotionParentPageOption[]; resolvedSaved: NotionParentPageOption | null }> {
  const token = accessToken.trim();
  if (!token) throw new Error('missing notion access token');

  const savedNorm = normalizeId(savedPageId);
  let cursor: string | null = null;
  let foundPages: any[] = [];
  let resolvedSaved: any = null;

  for (;;) {
    const { pages, allResults, hasMore, nextCursor } = await searchParentPagesOnce(token, cursor);

    if (savedNorm && !resolvedSaved) {
      const hit = allResults.find((page: any) => normalizeId(page?.id) === savedNorm) || null;
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
    resolvedSaved = await retrievePage(token, String(savedPageId || '').trim());
  }

  const list = foundPages.map(toOption).filter(Boolean) as NotionParentPageOption[];
  const savedOption = resolvedSaved ? toOption(resolvedSaved) : null;
  return {
    pages: dedupeOptions(savedOption ? [savedOption, ...list] : list),
    resolvedSaved: savedOption,
  };
}
