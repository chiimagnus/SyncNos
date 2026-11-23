import type { ConversationMessage } from '@services/conversations/domain/models';
import { getImageCacheAssetsByIds } from '@services/conversations/data/image-cache-read';
import { inspectImageBlob } from '@services/conversations/data/image-format';
import { collectMarkdownImageReferences } from '@services/shared/markdown-image-references';
import { parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';

export type ConversationStorageImage = {
  id: number;
  label: string;
  bytes: number;
  format: string;
  optimizable: boolean;
};

export type ConversationStorageDetails = {
  imageBytes: number;
  images: ConversationStorageImage[];
};

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Storage inspection cancelled', 'AbortError');
}

/** Only readable local images referenced by the current item; remote and missing resources have no local size. */
export async function getConversationStorageDetails(input: {
  conversationId: number;
  messages: readonly ConversationMessage[];
  signal?: AbortSignal;
}): Promise<ConversationStorageDetails> {
  const { conversationId, messages, signal } = input;
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) throw new Error('invalid_conversation_id');
  checkCancelled(signal);

  const assetLabels = new Map<number, string>();
  for (const message of messages) {
    checkCancelled(signal);
    for (const reference of collectMarkdownImageReferences(message.contentMarkdown)) {
      const id = parseSyncnosAssetId(reference.target);
      if (id != null && !assetLabels.has(id)) assetLabels.set(id, reference.alt.trim().slice(0, 120));
    }
  }

  const images: ConversationStorageImage[] = [];
  let imageBytes = 0;
  const assetIds = [...assetLabels.keys()];
  for (let start = 0; start < assetIds.length; start += 24) {
    checkCancelled(signal);
    const batch = assetIds.slice(start, start + 24);
    const assets = await getImageCacheAssetsByIds({ ids: batch, conversationId });
    for (const id of batch) {
      checkCancelled(signal);
      const asset = assets.get(id);
      if (!asset || asset.blob.size === 0) continue;
      const inspected = await inspectImageBlob(asset.blob);
      const format =
        inspected.format === 'unknown'
          ? (asset.contentType.split(';')[0] || '').replace(/^image\//, '').toUpperCase() || '未知'
          : inspected.format.toUpperCase();
      const label =
        assetLabels.get(id) ||
        (() => {
          try {
            return decodeURIComponent(new URL(asset.url).pathname.split('/').pop() || '') || `图片资源 #${id}`;
          } catch {
            return `图片资源 #${id}`;
          }
        })();
      const bytes = asset.blob.size;
      imageBytes += bytes;
      images.push({
        id,
        label: label.slice(0, 120),
        bytes,
        format,
        optimizable:
          inspected.format === 'png' &&
          inspected.animation === 'static' &&
          (!asset.blob.type || asset.blob.type === 'image/png') &&
          (!asset.contentType || asset.contentType.split(';')[0].toLowerCase() === 'image/png'),
      });
    }
  }

  return { imageBytes, images };
}
