import { extractNotionWorkspaceSlugFromUrl } from '@services/sync/notion/notion-url-utils';
import { normalizeNotionId } from '@services/shared/notion-id';

export function buildNotionPageUrl(
  pageId?: string | null,
  opts?: { workspaceSlug?: string | null; pageUrl?: string | null },
): string {
  const normalizedPageId = normalizeNotionId(pageId);
  if (!normalizedPageId) return '';

  const explicitSlug = String(opts?.workspaceSlug || '').trim();
  const urlSlug = extractNotionWorkspaceSlugFromUrl(opts?.pageUrl);
  const slug = explicitSlug || urlSlug;
  if (slug) return `https://app.notion.com/p/${slug}/${normalizedPageId}`;

  // Fallback: Notion's canonical web URL format works without a workspace segment.
  return `https://www.notion.so/${normalizedPageId}`;
}
