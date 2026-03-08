import type { Conversation } from '../../conversations/domain/models';
import { tabsCreate } from '../../platform/webext/tabs';

export const DETAIL_HEADER_ACTION_LABELS = {
  openInNotion: 'Open in Notion',
} as const;

export type DetailHeaderActionKind = 'external-link';

export type DetailHeaderAction = {
  id: string;
  label: string;
  kind: DetailHeaderActionKind;
  href: string;
  onTrigger: () => Promise<void>;
};

export type DetailHeaderActionPort = {
  openExternalUrl: (url: string) => Promise<boolean>;
};

export type ResolveDetailHeaderActionsInput = {
  conversation: Conversation | null | undefined;
  port?: DetailHeaderActionPort;
};

const NOTION_PAGE_ID_PATTERN = /^[0-9a-f]{32}$/i;

export function normalizeNotionPageId(pageId?: string | null): string {
  const compact = String(pageId || '').trim().replace(/-/g, '');
  return NOTION_PAGE_ID_PATTERN.test(compact) ? compact.toLowerCase() : '';
}

export function buildNotionPageUrl(pageId?: string | null): string {
  const normalizedPageId = normalizeNotionPageId(pageId);
  return normalizedPageId ? `https://www.notion.so/${normalizedPageId}` : '';
}

export async function openDetailHeaderExternalUrl(url: string): Promise<boolean> {
  const safeUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(safeUrl)) return false;

  try {
    await tabsCreate({ url: safeUrl, active: true });
    return true;
  } catch (_error) {
    // Fall back to the browser window API for test environments and degraded runtimes.
  }

  try {
    globalThis.window?.open(safeUrl, '_blank', 'noopener,noreferrer');
    return true;
  } catch (_error) {
    return false;
  }
}

export const defaultDetailHeaderActionPort: DetailHeaderActionPort = {
  openExternalUrl: openDetailHeaderExternalUrl,
};

export function resolveDetailHeaderActions({
  conversation,
  port = defaultDetailHeaderActionPort,
}: ResolveDetailHeaderActionsInput): DetailHeaderAction[] {
  const notionUrl = buildNotionPageUrl(conversation?.notionPageId);
  if (!notionUrl) return [];

  return [
    {
      id: 'open-in-notion',
      label: DETAIL_HEADER_ACTION_LABELS.openInNotion,
      kind: 'external-link',
      href: notionUrl,
      onTrigger: async () => {
        const opened = await port.openExternalUrl(notionUrl);
        if (!opened) throw new Error('Failed to open Notion page');
      },
    },
  ];
}
