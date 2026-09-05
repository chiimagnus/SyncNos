import type { Conversation, ConversationDetail } from '@services/conversations/domain/models';
import { formatConversationMarkdown } from '@services/conversations/domain/markdown';
import {
  collectMarkdownImageReferences,
  replaceMarkdownImageReferences,
} from '@services/shared/markdown-image-references';
import { isSyncnosAssetUrl } from '@services/shared/syncnos-asset-uri';

function isDataImageUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  if (!text) return false;
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?(?:;base64)?,/i.test(text);
}

function materializeMarkdownAssetPlaceholders(input: { markdown: string }): string {
  const markdown = String(input.markdown || '');
  if (!markdown) return '';

  const references = collectMarkdownImageReferences(markdown);
  return replaceMarkdownImageReferences(markdown, references, (reference) => {
    if (!isDataImageUrl(reference.target) && !isSyncnosAssetUrl(reference.target)) return null;
    const alt = reference.alt.trim();
    return { replacement: `[${alt ? `Image: ${alt}` : 'Image omitted'}]` };
  });
}

export async function formatConversationMarkdownForExternalOutput(
  conversation: Conversation,
  detail: ConversationDetail,
): Promise<string> {
  const raw = formatConversationMarkdown(conversation, (detail?.messages || []) as any);
  return materializeMarkdownAssetPlaceholders({ markdown: raw });
}
