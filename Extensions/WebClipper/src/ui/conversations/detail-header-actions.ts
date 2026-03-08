import type { Conversation, ConversationDetail } from '../../conversations/domain/models';
import { formatConversationMarkdown } from '../../conversations/domain/markdown';
import { tabsCreate } from '../../platform/webext/tabs';
import { launchObsidianApp } from '../../sync/obsidian/obsidian-app-launch';
import {
  openObsidianTarget,
  reportObsidianOpenError,
  resolveObsidianOpenTarget,
  waitForDelay,
} from './detail-header-obsidian-target';

export const DETAIL_HEADER_ACTION_LABELS = {
  openInNotion: 'Open in Notion',
  openInObsidian: 'Open in Obsidian',
  chatWithChatGpt: 'Chat with ChatGPT',
} as const;

export type DetailHeaderActionKind = 'external-link' | 'open-target';

export type DetailHeaderActionProvider = 'notion' | 'obsidian' | 'chatgpt';

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

const CHATGPT_URL = 'https://chatgpt.com/' as const;

const DEFAULT_CHAT_WITH_PROMPT = '和我聊聊这个内容说了什么' as const;

const DEFAULT_MAX_CHAT_WITH_CHARS = 28_000 as const;

function truncateForChatWith(input: string, maxChars: number): { text: string; truncated: boolean } {
  const text = String(input || '');
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(1, Math.floor(Number(maxChars))) : DEFAULT_MAX_CHAT_WITH_CHARS;
  if (text.length <= limit) return { text, truncated: false };
  const suffix = `\n\n[Truncated: original length=${text.length}]`;
  const sliceLen = Math.max(0, limit - suffix.length);
  return { text: `${text.slice(0, sliceLen)}${suffix}`, truncated: true };
}

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

function buildChatWithChatGptAction({
  conversation,
  detail,
  port = defaultDetailHeaderActionPort,
}: ResolveDetailHeaderActionsInput): DetailHeaderAction | null {
  if (!conversation || !detail || !Array.isArray(detail.messages) || !detail.messages.length) return null;
  // Guard against stale detail data when the active conversation switches.
  if (Number(detail.conversationId) !== Number(conversation.id)) return null;

  const formatted = formatConversationMarkdown(conversation, detail.messages as any);
  const payload = `${DEFAULT_CHAT_WITH_PROMPT}\n\n---\n\n${formatted}\n`;
  const truncated = truncateForChatWith(payload, DEFAULT_MAX_CHAT_WITH_CHARS);

  return {
    id: 'chat-with-chatgpt',
    label: DETAIL_HEADER_ACTION_LABELS.chatWithChatGpt,
    kind: 'external-link',
    provider: 'chatgpt',
    slot: 'chat-with',
    href: CHATGPT_URL,
    afterTriggerLabel: `✅ 已复制，正在跳转 ChatGPT…${truncated.truncated ? ' (truncated)' : ''}`,
    onTrigger: async () => {
      const copied = await writeTextToClipboard(truncated.text);
      if (!copied) throw new Error('Failed to copy content to clipboard');
      const opened = await port.openExternalUrl(CHATGPT_URL);
      if (!opened) throw new Error('Failed to open ChatGPT');
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

  const chatgptAction = buildChatWithChatGptAction({ conversation, detail, port });
  if (chatgptAction) actions.push(chatgptAction);

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
