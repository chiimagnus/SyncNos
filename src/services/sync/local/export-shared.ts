import { getImageCacheAssetsByIds, type ImageCacheAsset } from '@services/conversations/data/image-cache-read';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import type { Conversation } from '@services/conversations/domain/models';
import {
  collectMarkdownImageReferences,
  replaceMarkdownImageReferences,
  type MarkdownImageReference,
} from '@services/shared/markdown-image-references';
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

function inferImageExt(asset: ImageCacheAsset): string {
  const contentType = (asset.contentType || asset.blob.type).trim().toLowerCase();
  if (contentType.startsWith('image/')) return normalizeImageExt(contentType.slice('image/'.length));

  try {
    const url = new URL(asset.url);
    const filename = url.pathname.split('/').filter(Boolean).pop() || '';
    const dot = filename.lastIndexOf('.');
    if (dot >= 0 && dot < filename.length - 1) return normalizeImageExt(filename.slice(dot + 1));
  } catch (_error) {
    // Fall through to the stable default.
  }
  return 'png';
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

  for (const source of input.markdown) {
    const references = collectMarkdownImageReferences(source);
    referencesByMarkdown.push(references);
    for (const reference of references) {
      const assetId = parseSyncnosAssetId(reference.target);
      if (assetId == null || seenAssetIds.has(assetId)) continue;
      seenAssetIds.add(assetId);
      orderedAssetIds.push(assetId);
    }
  }

  const assets = orderedAssetIds.length
    ? await getImageCacheAssetsByIds({ ids: orderedAssetIds, conversationId: input.conversationId })
    : new Map<number, ImageCacheAsset>();
  const attachmentPathById = new Map<number, string>();
  const attachments: MaterializedExportAttachment[] = [];

  for (const assetId of orderedAssetIds) {
    const asset = assets.get(assetId);
    if (!asset) continue;
    const index = input.nextAttachmentIndex();
    const path = `attachments/${input.basename}-${String(index).padStart(4, '0')}.${inferImageExt(asset)}`;
    attachmentPathById.set(assetId, path);
    attachments.push({ path, blob: asset.blob, mediaType: resolveMediaType(asset), byteSize: asset.blob.size });
  }

  const rewritten = input.markdown.map((source, index) =>
    replaceMarkdownImageReferences(source, referencesByMarkdown[index]!, (reference) => {
      if (!isSyncnosAssetUrl(reference.target)) return null;
      const assetId = parseSyncnosAssetId(reference.target);
      if (assetId == null) return { replacement: '[Image unavailable]' };
      const target = attachmentPathById.get(assetId);
      return target ? { target } : { replacement: '[Image unavailable]' };
    }),
  );

  return { markdown: rewritten, attachments };
}
