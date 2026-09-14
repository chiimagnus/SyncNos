import { getImageCacheAssetsByIds, type ImageCacheAsset } from '@services/conversations/data/image-cache-read';
import { downloadChatgptImagesForStoredConversation } from '@services/integrations/chatgpt/conversation-image-assets';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import type { Conversation } from '@services/conversations/domain/models';
import {
  collectMarkdownImageReferences,
  replaceMarkdownImageReferences,
  type MarkdownImageReference,
} from '@services/shared/markdown-image-references';
import { chatgptFileIdFromUrl, hasChatgptFileScheme } from '@services/shared/chatgpt-image-identity';
import { isSyncnosAssetUrl, parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';

function normalizeImageExt(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return 'png';
  if (value === 'jpeg') return 'jpg';
  if (value === 'svg+xml') return 'svg';
  if (value === 'x-icon' || value === 'vnd.microsoft.icon') return 'ico';
  return /^[a-z0-9]+$/.test(value) ? value : 'png';
}

function normalizeMediaType(raw: string): string | null {
  const normalized = raw.split(';')[0]!.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(normalized) ? normalized : null;
}

function resolveMediaType(asset: ImageCacheAsset): string {
  return normalizeMediaType(asset.contentType) || normalizeMediaType(asset.blob.type) || 'application/octet-stream';
}

function inferImageExtFromSource(contentType: unknown, sourceUrl: unknown): string {
  const normalizedContentType = String(contentType || '')
    .trim()
    .toLowerCase();
  if (normalizedContentType.startsWith('image/')) {
    return normalizeImageExt(normalizedContentType.slice('image/'.length));
  }

  try {
    const url = new URL(String(sourceUrl || ''));
    const filename = url.pathname.split('/').filter(Boolean).pop() || '';
    const dot = filename.lastIndexOf('.');
    if (dot >= 0 && dot < filename.length - 1) return normalizeImageExt(filename.slice(dot + 1));
  } catch (_error) {
    // Fall through to the stable default.
  }
  return 'png';
}

function inferImageExt(asset: ImageCacheAsset): string {
  return inferImageExtFromSource(asset.contentType || asset.blob.type, asset.url);
}

export function claimUniqueConversationExportBasename(conversation: Conversation, usedBasenames: Set<string>): string {
  const base = buildConversationBasename(conversation);
  let candidate = base;
  let suffix = 2;
  while (usedBasenames.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedBasenames.add(candidate);
  return candidate;
}

export type MaterializedExportAttachment = {
  path: string;
  blob: Blob;
  mediaType: string;
  byteSize: number;
};

export async function materializeConversationMarkdownAssets(input: {
  conversationId: number;
  markdown: readonly string[];
  basename: string;
  nextAttachmentIndex: () => number;
}) {
  const referencesByMarkdown: MarkdownImageReference[][] = [];
  const orderedAssetIds: number[] = [];
  const seenAssetIds = new Set<number>();
  const orderedChatgptFileIds: string[] = [];
  const seenChatgptFileIds = new Set<string>();

  for (const source of input.markdown) {
    const references = collectMarkdownImageReferences(source);
    referencesByMarkdown.push(references);
    for (const reference of references) {
      const assetId = parseSyncnosAssetId(reference.target);
      if (assetId != null && !seenAssetIds.has(assetId)) {
        seenAssetIds.add(assetId);
        orderedAssetIds.push(assetId);
      }
      const fileId = chatgptFileIdFromUrl(reference.target);
      if (fileId && !seenChatgptFileIds.has(fileId)) {
        seenChatgptFileIds.add(fileId);
        orderedChatgptFileIds.push(fileId);
      }
    }
  }

  const assets = orderedAssetIds.length
    ? await getImageCacheAssetsByIds({ ids: orderedAssetIds, conversationId: input.conversationId })
    : new Map<number, ImageCacheAsset>();
  const attachmentPathById = new Map<number, string>();
  const attachmentPathByChatgptFileId = new Map<string, string>();
  const attachments: MaterializedExportAttachment[] = [];

  for (const assetId of orderedAssetIds) {
    const asset = assets.get(assetId);
    if (!asset) continue;
    const index = input.nextAttachmentIndex();
    const path = `attachments/${input.basename}-${String(index).padStart(4, '0')}.${inferImageExt(asset)}`;
    attachmentPathById.set(assetId, path);
    attachments.push({ path, blob: asset.blob, mediaType: resolveMediaType(asset), byteSize: asset.blob.size });
  }

  if (orderedChatgptFileIds.length) {
    const downloaded = await downloadChatgptImagesForStoredConversation({
      conversationId: input.conversationId,
      fileIds: orderedChatgptFileIds,
      concurrency: 4,
    });
    const downloadedByFileId = new Map(downloaded.map((item, index) => [orderedChatgptFileIds[index]!, item] as const));
    for (const fileId of orderedChatgptFileIds) {
      const item = downloadedByFileId.get(fileId);
      if (!item?.ok) continue;
      const index = input.nextAttachmentIndex();
      const path = `attachments/${input.basename}-${String(index).padStart(4, '0')}.${inferImageExtFromSource(item.contentType, '')}`;
      attachmentPathByChatgptFileId.set(fileId, path);
      attachments.push({ path, blob: item.blob, mediaType: item.contentType, byteSize: item.byteSize });
    }
  }

  const rewritten = input.markdown.map((source, index) =>
    replaceMarkdownImageReferences(source, referencesByMarkdown[index]!, (reference) => {
      if (isSyncnosAssetUrl(reference.target)) {
        const assetId = parseSyncnosAssetId(reference.target);
        if (assetId == null) return { replacement: '[Image unavailable]' };
        const target = attachmentPathById.get(assetId);
        return target ? { target } : { replacement: '[Image unavailable]' };
      }
      const fileId = chatgptFileIdFromUrl(reference.target);
      if (fileId) {
        const target = attachmentPathByChatgptFileId.get(fileId);
        return target ? { target } : { replacement: '[Image unavailable]' };
      }
      if (hasChatgptFileScheme(reference.target)) return { replacement: '[Image unavailable]' };
      return null;
    }),
  );

  return { markdown: rewritten, attachments };
}
