import { collectMarkdownImageReferences } from '@services/shared/markdown-image-references';
import { parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';

type CountableImageMessage = {
  contentMarkdown?: string | null;
};

export type ConversationImageCount = {
  total: number;
  cached: number;
  uncached: number;
};

export function countConversationMessageImages(messages: CountableImageMessage[]): ConversationImageCount {
  let total = 0;
  let cached = 0;

  for (const message of messages || []) {
    const markdown = String(message?.contentMarkdown ?? '');
    if (!markdown) continue;

    for (const reference of collectMarkdownImageReferences(markdown)) {
      total += 1;
      if (parseSyncnosAssetId(reference.target) != null) cached += 1;
    }
  }

  return { total, cached, uncached: total - cached };
}
