import type { Conversation, ConversationDetail } from '@services/conversations/domain/models';
import type { DetailHeaderAction, DetailHeaderActionPort } from '@services/integrations/detail-header-action-types';
import {
  buildChatWithPayload,
  loadChatWithSettings,
  truncateForChatWith,
  type ChatWithAiPlatform,
} from '@services/integrations/chatwith/chatwith-settings';
import { writeTextToClipboard } from '@services/integrations/chatwith/chatwith-clipboard';
import {
  openChatWithPlatform,
  type ChatWithOpenPlatformPort,
} from '@services/integrations/chatwith/chatwith-open-port';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

function safeText(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveArticleKeyForChatWith(conversation: Conversation): string | null {
  if (!conversation) return null;
  const sourceType = safeText((conversation as any)?.sourceType);
  const conversationKey = safeText((conversation as any)?.conversationKey);
  if (sourceType !== 'article' && !conversationKey.startsWith('article:')) return null;

  const url = canonicalizeArticleUrl((conversation as any)?.url);
  if (url) return url;

  if (conversationKey.startsWith('article:')) {
    const raw = conversationKey.slice('article:'.length);
    const canonical = canonicalizeArticleUrl(raw);
    return canonical || safeText(raw) || null;
  }
  return null;
}

function buildChatWithPlatformAction(input: {
  conversation: Conversation | null | undefined;
  detail: ConversationDetail | null | undefined;
  port: DetailHeaderActionPort;
  platform: ChatWithAiPlatform;
  payload: string;
  maxChars: number;
  openPort?: ChatWithOpenPlatformPort | null;
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
  const adapterOpenPort: ChatWithOpenPlatformPort = {
    openPlatform: async (_platformId, fallbackUrl) => {
      const target = String(fallbackUrl || '').trim();
      if (!target) return false;
      return port.openExternalUrl(target);
    },
  };
  const openPort = input.openPort || adapterOpenPort;
  const articleKey = resolveArticleKeyForChatWith(conversation);

  return {
    id: `chat-with-${String(platform.id || '').trim()}`,
    label,
    kind: 'external-link',
    provider: String(platform.id || 'chat-with'),
    slot: 'tools',
    href,
    afterTriggerLabel: after,
    onTrigger: async () => {
      const copied = await writeTextToClipboard(truncated.text);
      if (!copied) throw new Error('Failed to copy content to clipboard');
      const opened = await openChatWithPlatform({
        platform,
        port: openPort,
        context: articleKey
          ? {
              articleKey,
            }
          : null,
      });
      if (!opened) throw new Error(`Failed to open ${String(platform.name || '').trim()}`);
    },
  };
}

export async function resolveChatWithDetailHeaderActions({
  conversation,
  detail,
  port,
  openPort,
}: {
  conversation: Conversation | null | undefined;
  detail: ConversationDetail | null | undefined;
  port: DetailHeaderActionPort;
  openPort?: ChatWithOpenPlatformPort | null;
}): Promise<DetailHeaderAction[]> {
  try {
    if (!conversation || !detail || !Array.isArray(detail.messages) || !detail.messages.length) return [];

    const settings = await loadChatWithSettings();
    const payload = await buildChatWithPayload(conversation, detail as any, settings.promptTemplate);

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
        openPort,
      });
      if (action) actions.push(action);
    }

    return actions;
  } catch (_e) {
    return [];
  }
}

export async function resolveSingleEnabledChatWithActionLabel(): Promise<string | null> {
  try {
    const settings = await loadChatWithSettings();
    const enabled = (settings.platforms || []).filter((platform) => platform && platform.enabled);
    if (enabled.length !== 1) return null;
    const name = String(enabled[0]?.name || '').trim();
    if (!name) return null;
    return `Chat with ${name}`;
  } catch (_e) {
    return null;
  }
}
