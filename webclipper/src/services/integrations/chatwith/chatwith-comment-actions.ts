import {
  loadChatWithSettings,
  truncateForChatWith,
  type ChatWithAiPlatform,
} from '@services/integrations/chatwith/chatwith-settings';
import { writeTextToClipboard } from '@services/integrations/chatwith/chatwith-clipboard';
import { resolveSingleEnabledChatWithActionLabel } from '@services/integrations/chatwith/chatwith-detail-header-actions';
import { buildChatWithCommentPayloadV1 } from '@services/integrations/chatwith/chatwith-comment-payload';

export type ResolveChatWithCommentActionsInput = {
  quoteText?: string | null;
  commentText?: string | null;
  articleTitle?: string | null;
  canonicalUrl?: string | null;
};

export type ChatWithCommentAction = {
  id: string;
  label: string;
  disabled?: boolean;
  onTrigger: () => Promise<string | void>;
};

function safeText(value: unknown): string {
  return String(value ?? '').trim();
}

function pickEnabledPlatforms(platforms: ChatWithAiPlatform[]): ChatWithAiPlatform[] {
  const out: ChatWithAiPlatform[] = [];
  for (const platform of platforms || []) {
    if (!platform || !platform.enabled) continue;
    const id = safeText(platform.id);
    const name = safeText(platform.name);
    if (!id || !name) continue;
    out.push(platform);
  }
  return out;
}

function buildActionLabel(platform: ChatWithAiPlatform, singleLabel: string | null): string {
  const defaultLabel = `Chat with ${safeText(platform.name)}`;
  const normalizedSingleLabel = safeText(singleLabel);
  return normalizedSingleLabel || defaultLabel;
}

export async function resolveChatWithCommentActions(
  input: ResolveChatWithCommentActionsInput,
): Promise<ChatWithCommentAction[]> {
  const commentText = safeText(input?.commentText);
  if (!commentText) return [];

  const settings = await loadChatWithSettings();
  const enabledPlatforms = pickEnabledPlatforms(settings.platforms || []);
  if (!enabledPlatforms.length) return [];

  const payload = buildChatWithCommentPayloadV1({
    quoteText: input?.quoteText,
    commentText,
    articleTitle: input?.articleTitle,
    canonicalUrl: input?.canonicalUrl,
  });
  if (!safeText(payload)) return [];

  const truncated = truncateForChatWith(payload, settings.maxChars);
  const singleLabel =
    enabledPlatforms.length === 1 ? await resolveSingleEnabledChatWithActionLabel() : null;

  const actions: ChatWithCommentAction[] = [];
  for (const platform of enabledPlatforms) {
    const platformId = safeText(platform.id);
    const platformName = safeText(platform.name);
    if (!platformId || !platformName) continue;

    actions.push({
      id: `chat-with-${platformId}`,
      label: buildActionLabel(platform, singleLabel),
      onTrigger: async () => {
        const copied = await writeTextToClipboard(truncated.text);
        if (!copied) throw new Error('Failed to copy content to clipboard');
        return `✅ 已复制，可前往 ${platformName}${truncated.truncated ? '… (truncated)' : '。'}`;
      },
    });
  }

  return actions;
}
