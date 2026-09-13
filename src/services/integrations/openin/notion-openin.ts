import { extractNotionWorkspaceSlugFromUrl } from '@services/sync/notion/notion-url-utils';

const NOTION_PAGE_ID_PATTERN = /^[0-9a-f]{32}$/i;

export function normalizeNotionPageId(pageId?: string | null): string {
  const compact = String(pageId || '')
    .trim()
    .replace(/-/g, '');
  return NOTION_PAGE_ID_PATTERN.test(compact) ? compact.toLowerCase() : '';
}

export function buildNotionPageUrl(
  pageId?: string | null,
  opts?: { workspaceSlug?: string | null; pageUrl?: string | null },
): string {
  const normalizedPageId = normalizeNotionPageId(pageId);
  if (!normalizedPageId) return '';

  const explicitSlug = String(opts?.workspaceSlug || '').trim();
  const urlSlug = extractNotionWorkspaceSlugFromUrl(opts?.pageUrl);
  const slug = explicitSlug || urlSlug;
  if (slug) return `https://app.notion.com/p/${slug}/${normalizedPageId}`;

  // Fallback: Notion's canonical web URL format works without a workspace segment.
  return `https://www.notion.so/${normalizedPageId}`;
}
