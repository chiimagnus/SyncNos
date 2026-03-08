import type { Conversation } from '../../conversations/domain/models';
import type { DetailHeaderAction, DetailHeaderActionPort } from '../detail-header-action-types';
import {
  openObsidianTarget,
  resolveObsidianOpenTarget,
} from './obsidian-open-target';

export const DETAIL_HEADER_ACTION_LABELS = {
  openInNotion: 'Open in Notion',
  openInObsidian: 'Open in Obsidian',
} as const;

const NOTION_PAGE_ID_PATTERN = /^[0-9a-f]{32}$/i;

export function normalizeNotionPageId(pageId?: string | null): string {
  const compact = String(pageId || '').trim().replace(/-/g, '');
  return NOTION_PAGE_ID_PATTERN.test(compact) ? compact.toLowerCase() : '';
}

export function buildNotionPageUrl(pageId?: string | null): string {
  const normalizedPageId = normalizeNotionPageId(pageId);
  return normalizedPageId ? `https://www.notion.so/${normalizedPageId}` : '';
}

function buildNotionOpenInAction({
  conversation,
  port,
}: {
  conversation: Conversation | null | undefined;
  port: DetailHeaderActionPort;
}): DetailHeaderAction | null {
  const notionUrl = buildNotionPageUrl(conversation?.notionPageId);
  if (!notionUrl) return null;

  return {
    id: 'open-in-notion',
    label: DETAIL_HEADER_ACTION_LABELS.openInNotion,
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

async function buildObsidianOpenInAction({
  conversation,
  port,
}: {
  conversation: Conversation | null | undefined;
  port: DetailHeaderActionPort;
}): Promise<DetailHeaderAction | null> {
  const obsidianTarget = await resolveObsidianOpenTarget({ conversation });
  if (!obsidianTarget.available || !obsidianTarget.trigger) return null;

  return {
    id: 'open-in-obsidian',
    label: DETAIL_HEADER_ACTION_LABELS.openInObsidian,
    kind: 'open-target',
    provider: 'obsidian',
    slot: 'open',
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
  };
}

export async function resolveOpenInDetailHeaderActions({
  conversation,
  port,
}: {
  conversation: Conversation | null | undefined;
  port: DetailHeaderActionPort;
}): Promise<DetailHeaderAction[]> {
  const actions: DetailHeaderAction[] = [];

  const notionAction = buildNotionOpenInAction({ conversation, port });
  if (notionAction) actions.push(notionAction);

  try {
    const obsidianAction = await buildObsidianOpenInAction({ conversation, port });
    if (obsidianAction) actions.push(obsidianAction);
  } catch (_error) {
    // Preserve already-resolved actions such as Notion even if the Obsidian capability probe fails.
  }

  return actions;
}

