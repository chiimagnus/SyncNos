import type { Conversation } from '../../conversations/domain/models';
import { tabsCreate } from '../../platform/webext/tabs';
import {
  openObsidianTarget,
  reportObsidianOpenError,
  resolveObsidianOpenTarget,
  waitForDelay,
} from './detail-header-obsidian-target';

export const DETAIL_HEADER_ACTION_LABELS = {
  openInNotion: 'Open in Notion',
  openInObsidian: 'Open in Obsidian',
} as const;

export type DetailHeaderActionKind = 'external-link' | 'open-target';

export type DetailHeaderActionProvider = 'notion' | 'obsidian';

export type DetailHeaderAction = {
  id: string;
  label: string;
  kind: DetailHeaderActionKind;
  provider: DetailHeaderActionProvider;
  href?: string;
  triggerPayload?: Record<string, unknown>;
  onTrigger: () => Promise<void>;
};

export type DetailHeaderActionPort = {
  openExternalUrl: (url: string) => Promise<boolean>;
  launchProtocolUrl: (url: string) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
  reportError: (message: string) => void;
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

  return openDetailHeaderUrl(safeUrl);
}

export async function openDetailHeaderProtocolUrl(url: string): Promise<boolean> {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) return false;

  return openDetailHeaderUrl(safeUrl);
}

async function openDetailHeaderUrl(safeUrl: string): Promise<boolean> {
  if (!safeUrl) return false;

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
  launchProtocolUrl: openDetailHeaderProtocolUrl,
  wait: waitForDelay,
  reportError: reportObsidianOpenError,
};

function buildNotionDetailHeaderAction({
  conversation,
  port = defaultDetailHeaderActionPort,
}: ResolveDetailHeaderActionsInput): DetailHeaderAction | null {
  const notionUrl = buildNotionPageUrl(conversation?.notionPageId);
  if (!notionUrl) return null;

  return {
    id: 'open-in-notion',
    label: DETAIL_HEADER_ACTION_LABELS.openInNotion,
    kind: 'external-link',
    provider: 'notion',
    href: notionUrl,
    onTrigger: async () => {
      const opened = await port.openExternalUrl(notionUrl);
      if (!opened) throw new Error('Failed to open Notion page');
    },
  };
}

export async function resolveDetailHeaderActions({
  conversation,
  port = defaultDetailHeaderActionPort,
}: ResolveDetailHeaderActionsInput): Promise<DetailHeaderAction[]> {
  const actions: DetailHeaderAction[] = [];
  const notionAction = buildNotionDetailHeaderAction({ conversation, port });
  if (notionAction) actions.push(notionAction);

  try {
    const obsidianTarget = await resolveObsidianOpenTarget({ conversation });
    if (obsidianTarget.available && obsidianTarget.trigger) {
      actions.push({
        id: 'open-in-obsidian',
        label: DETAIL_HEADER_ACTION_LABELS.openInObsidian,
        kind: 'open-target',
        provider: 'obsidian',
        triggerPayload: obsidianTarget.trigger as unknown as Record<string, unknown>,
        onTrigger: async () => {
          await openObsidianTarget({
            trigger: obsidianTarget.trigger!,
            port: {
              launchProtocolUrl: port.launchProtocolUrl,
              wait: port.wait,
              reportError: port.reportError,
            },
          });
        },
      });
    }
  } catch (_error) {
    // Preserve already-resolved actions such as Notion even if the Obsidian capability probe fails.
  }

  return actions;
}
