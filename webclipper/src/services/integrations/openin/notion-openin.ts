import type { Conversation } from '@services/conversations/domain/models';
import type { DetailHeaderAction, DetailHeaderActionPort } from '@services/integrations/detail-header-action-types';

const NOTION_PAGE_ID_PATTERN = /^[0-9a-f]{32}$/i;

export function normalizeNotionPageId(pageId?: string | null): string {
  const compact = String(pageId || '')
    .trim()
    .replace(/-/g, '');
  return NOTION_PAGE_ID_PATTERN.test(compact) ? compact.toLowerCase() : '';
}

export function buildNotionPageUrl(pageId?: string | null): string {
  const normalizedPageId = normalizeNotionPageId(pageId);
  return normalizedPageId ? `https://www.notion.so/${normalizedPageId}` : '';
}

export function buildNotionOpenInAction({
  conversation,
  port,
  labels,
}: {
  conversation: Conversation | null | undefined;
  port: DetailHeaderActionPort;
  labels: { openInNotion: string };
}): DetailHeaderAction | null {
  const notionUrl = buildNotionPageUrl(conversation?.notionPageId);
  if (!notionUrl) return null;

  return {
    id: 'open-in-notion',
    label: labels.openInNotion,
    kind: 'external-link',
    provider: 'notion',
    slot: 'open',
    href: notionUrl,
    onTrigger: async () => {
      const opened = await port.openExternalUrl(notionUrl);
      if (!opened) throw new Error('Failed to open Notion page');
    },
  };
}
