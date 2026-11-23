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
  state: 'ready' | 'missing';
  optimizable: boolean;
};

export type ConversationStorageDetails = {
  textBytes: number;
  imageBytes: number;
  totalBytes: number;
  localReferences: number;
  otherReferences: number;
  missingReferences: number;
  images: ConversationStorageImage[];
};

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Storage inspection cancelled', 'AbortError');
}

/**
 * Counts the logical UTF-8 bytes of saved message content plus the unique,
 * readable image blobs referenced by this conversation. Not an IDB disk estimate.
 */
export async function getConversationStorageDetails(input: {
  conversationId: number;
  messages: readonly ConversationMessage[];
  signal?: AbortSignal;
}): Promise<ConversationStorageDetails> {
  const { conversationId, messages, signal } = input;
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) throw new Error('invalid_conversation_id');
  checkCancelled(signal);

  const encoder = new TextEncoder();
  const assetLabels = new Map<number, string>();
  let textBytes = 0;
  let localReferences = 0;
  let otherReferences = 0;

  for (const message of messages) {
    checkCancelled(signal);
    const markdown = String(message.contentMarkdown || '');
    const fallback = markdown
      ? ''
      : Array.isArray(message.transcriptCues)
        ? message.transcriptCues.map((cue) => String(cue.text || '')).join('\n')
        : '';
    const chapters =
      !markdown && Array.isArray(message.videoChapters)
        ? message.videoChapters.map((chapter) => String(chapter.title || '')).join('\n')
        : '';
    textBytes += encoder.encode(markdown || fallback).byteLength + encoder.encode(chapters).byteLength;

    for (const reference of collectMarkdownImageReferences(markdown)) {
      const id = parseSyncnosAssetId(reference.target);
      if (id == null) {
        otherReferences += 1;
        continue;
      }
      localReferences += 1;
      if (!assetLabels.has(id)) assetLabels.set(id, reference.alt.trim().slice(0, 120));
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
      if (!asset) {
        images.push({
          id,
          label: assetLabels.get(id) || `图片资源 #${id}`,
          bytes: 0,
          format: '',
          state: 'missing',
          optimizable: false,
        });
        continue;
      }
      const inspected = await inspectImageBlob(asset.blob);
      const format =
        inspected.format === 'unknown'
          ? (asset.contentType.split(';')[0] || '').replace(/^image\//, '').toUpperCase() || '未知'
          : inspected.format.toUpperCase();
      const label =
        assetLabels.get(id) ||
        ((): string => {
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
        state: 'ready',
        optimizable:
          inspected.format === 'png' &&
          inspected.animation === 'static' &&
          (!asset.blob.type || asset.blob.type === 'image/png') &&
          (!asset.contentType || asset.contentType.split(';')[0].toLowerCase() === 'image/png'),
      });
    }
  }

  return {
    textBytes,
    imageBytes,
    totalBytes: textBytes + imageBytes,
    localReferences,
    otherReferences,
    missingReferences: images.filter((asset) => asset.state === 'missing').length,
    images,
  };
}
