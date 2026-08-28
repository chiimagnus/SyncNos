import { CHATWITH_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import type { ChatWithSyncedUrls } from '@services/integrations/chatwith/chatwith-settings';
import { normalizePositiveInt } from '@services/shared/numbers';

type RuntimeSender = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

function safeText(value: unknown): string {
  return String(value ?? '').trim();
}

export async function resolveChatWithSyncedUrlsFromRuntime(
  runtime: RuntimeSender | null | undefined,
  conversationIdInput: unknown,
): Promise<ChatWithSyncedUrls> {
  const conversationId = normalizePositiveInt(conversationIdInput);
  if (!conversationId || !runtime?.send) return {};

  try {
    const response = await runtime.send(CHATWITH_MESSAGE_TYPES.RESOLVE_SYNCED_URLS, { conversationId });
    const data = response?.ok && response.data && typeof response.data === 'object' ? response.data : null;
    if (!data) return {};
    return {
      notionUrl: safeText(data.notionUrl),
      feishuUrl: safeText(data.feishuUrl),
      githubUrl: safeText(data.githubUrl),
    };
  } catch (_error) {
    return {};
  }
}
