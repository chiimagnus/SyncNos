import type { Conversation, ConversationDetail } from '../../conversations/domain/models';
import type { DetailHeaderAction, DetailHeaderActionPort } from '../detail-header-action-types';
import {
  buildChatWithPayload,
  loadChatWithSettings,
  truncateForChatWith,
  type ChatWithAiPlatform,
} from './chatwith-settings';

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
  port: DetailHeaderActionPort;
  platform: ChatWithAiPlatform;
  payload: string;
  maxChars: number;
}): DetailHeaderAction | null {
  const { conversation, detail, platform, payload, port } = input;
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

export async function resolveChatWithDetailHeaderActions({
  conversation,
  detail,
  port,
}: {
  conversation: Conversation | null | undefined;
  detail: ConversationDetail | null | undefined;
  port: DetailHeaderActionPort;
}): Promise<DetailHeaderAction[]> {
  try {
    if (!conversation || !detail || !Array.isArray(detail.messages) || !detail.messages.length) return [];

    const settings = await loadChatWithSettings();
    const payload = buildChatWithPayload(conversation, detail as any, settings.promptTemplate);

    const actions: DetailHeaderAction[] = [];
    for (const platform of settings.platforms || []) {
      if (!platform || !platform.enabled) continue;
      const action = buildChatWithPlatformAction({
        conversation,
        detail,
        port,
        platform,
        payload,
        maxChars: settings.maxChars,
      });
      if (action) actions.push(action);
    }

    return actions;
  } catch (_e) {
    return [];
  }
}

