import type { Conversation, ConversationDetail } from '../conversations/domain/models';
import { tabsCreate } from '../platform/webext/tabs';
import { launchObsidianApp } from '../sync/obsidian/obsidian-app-launch';
import { buildChatWithPayload, loadChatWithSettings, truncateForChatWith, type ChatWithAiPlatform } from './chat-with-settings';
import {
  openObsidianTarget,
  reportObsidianOpenError,
  resolveObsidianOpenTarget,
  waitForDelay,
} from './openin/obsidian-open-target';

export const DETAIL_HEADER_ACTION_LABELS = {
  openInNotion: 'Open in Notion',
  openInObsidian: 'Open in Obsidian',
} as const;

export type DetailHeaderActionKind = 'external-link' | 'open-target';

export type DetailHeaderActionProvider = string;

export type DetailHeaderActionSlot = 'open' | 'chat-with';

export type DetailHeaderAction = {
  id: string;
  label: string;
  kind: DetailHeaderActionKind;
  provider: DetailHeaderActionProvider;
  slot: DetailHeaderActionSlot;
  href?: string;
  triggerPayload?: Record<string, unknown>;
  afterTriggerLabel?: string;
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
  detail?: ConversationDetail | null | undefined;
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

  return launchObsidianApp(safeUrl);
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

async function writeTextToClipboard(value: string): Promise<boolean> {
  const text = String(value ?? '');
  if (!text) return false;

  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_e) {
    // ignore and fall back
  }

  try {
    // Best-effort fallback for older runtimes.
    const doc = globalThis.document;
    if (!doc) return false;
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    doc.body?.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = typeof doc.execCommand === 'function' ? doc.execCommand('copy') : false;
    ta.remove();
    return Boolean(ok);
  } catch (_e) {
    return false;
  }
}

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
    slot: 'open',
    href: notionUrl,
    onTrigger: async () => {
      const opened = await port.openExternalUrl(notionUrl);
      if (!opened) throw new Error('Failed to open Notion page');
    },
  };
}

function buildChatWithPlatformAction(input: {
  conversation: Conversation | null | undefined;
  detail: ConversationDetail | null | undefined;
  port?: DetailHeaderActionPort;
  platform: ChatWithAiPlatform;
  payload: string;
  maxChars: number;
}): DetailHeaderAction | null {
  const { conversation, detail, platform, payload } = input;
  const port = input.port || defaultDetailHeaderActionPort;
  const maxChars = Number(input.maxChars);

  if (!conversation || !detail || !Array.isArray(detail.messages) || !detail.messages.length) return null;
  if (!platform || !platform.enabled) return null;
  if (!String(platform.url || '').trim()) return null;
  if (!String(platform.name || '').trim()) return null;
  // Guard against stale detail data when the active conversation switches.
  if (Number(detail.conversationId) !== Number(conversation.id)) return null;

  const truncated = truncateForChatWith(payload, maxChars);
  const href = String(platform.url || '').trim();
  const label = `Chat with ${String(platform.name || '').trim()}`;
  const after = `✅ 已复制，正在跳转 ${String(platform.name || '').trim()}…${truncated.truncated ? ' (truncated)' : ''}`;

  return {
    id: `chat-with-${String(platform.id || '').trim()}`,
    label,
    kind: 'external-link',
    provider: String(platform.id || 'chat-with'),
    slot: 'chat-with',
    href,
    afterTriggerLabel: after,
    onTrigger: async () => {
      const copied = await writeTextToClipboard(truncated.text);
      if (!copied) throw new Error('Failed to copy content to clipboard');
      const opened = await port.openExternalUrl(href);
      if (!opened) throw new Error(`Failed to open ${String(platform.name || '').trim()}`);
    },
  };
}

export async function resolveDetailHeaderActions({
  conversation,
  detail,
  port = defaultDetailHeaderActionPort,
}: ResolveDetailHeaderActionsInput): Promise<DetailHeaderAction[]> {
  const actions: DetailHeaderAction[] = [];
  const notionAction = buildNotionDetailHeaderAction({ conversation, port });
  if (notionAction) actions.push(notionAction);

  try {
    if (conversation && detail && Array.isArray(detail.messages) && detail.messages.length) {
      const settings = await loadChatWithSettings();
      const payload = buildChatWithPayload(conversation, detail as any, settings.promptTemplate);
      for (const platform of settings.platforms || []) {
        if (!platform || !platform.enabled) continue;
        const action = buildChatWithPlatformAction({ conversation, detail, port, platform, payload, maxChars: settings.maxChars });
        if (action) actions.push(action);
      }
    }
  } catch (_e) {
    // Keep Open actions working even if loading settings fails.
  }

  try {
    const obsidianTarget = await resolveObsidianOpenTarget({ conversation });
    if (obsidianTarget.available && obsidianTarget.trigger) {
      actions.push({
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
      });
    }
  } catch (_error) {
    // Preserve already-resolved actions such as Notion even if the Obsidian capability probe fails.
  }

  return actions;
}
