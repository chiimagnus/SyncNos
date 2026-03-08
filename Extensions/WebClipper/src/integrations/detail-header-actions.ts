import type { Conversation, ConversationDetail } from '../conversations/domain/models';
import { launchObsidianApp } from '../sync/obsidian/obsidian-app-launch';
import type { DetailHeaderAction, DetailHeaderActionPort } from './detail-header-action-types';
import { openExternalUrl } from './open-external-url';
import { buildChatWithPayload, loadChatWithSettings, truncateForChatWith, type ChatWithAiPlatform } from './chat-with-settings';
import { reportObsidianOpenError, waitForDelay } from './openin/obsidian-open-target';
import {
  DETAIL_HEADER_ACTION_LABELS,
  resolveOpenInDetailHeaderActions,
} from './openin/openin-detail-header-actions';

export { DETAIL_HEADER_ACTION_LABELS } from './openin/openin-detail-header-actions';
export type { DetailHeaderAction, DetailHeaderActionPort } from './detail-header-action-types';

export type ResolveDetailHeaderActionsInput = {
  conversation: Conversation | null | undefined;
  detail?: ConversationDetail | null | undefined;
  port?: DetailHeaderActionPort;
};

export async function openDetailHeaderProtocolUrl(url: string): Promise<boolean> {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) return false;

  return launchObsidianApp(safeUrl);
}

export const defaultDetailHeaderActionPort: DetailHeaderActionPort = {
  openExternalUrl,
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
  const actions: DetailHeaderAction[] = await resolveOpenInDetailHeaderActions({ conversation, port });

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

  return actions;
}
