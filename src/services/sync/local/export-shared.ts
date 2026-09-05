import { getImageCacheAssetsByIds, type ImageCacheAsset } from '@services/conversations/data/image-cache-read';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import type { Conversation } from '@services/conversations/domain/models';
import { collectOrderedSyncnosAssetIds } from '@services/shared/markdown-asset-refs';
import {
  collectMarkdownImageReferences,
  replaceMarkdownImageReferences,
  type MarkdownImageReference,
} from '@services/shared/markdown-image-references';
import { isSyncnosAssetUrl, parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';

function normalizeImageExt(raw: unknown): string {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (!value) return 'png';
  if (value === 'jpeg') return 'jpg';
  if (value === 'svg+xml') return 'svg';
  if (value === 'x-icon' || value === 'vnd.microsoft.icon') return 'ico';
  return /^[a-z0-9]+$/.test(value) ? value : 'png';
}

function normalizeMediaType(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.split(';')[0]!.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(normalized) ? normalized : null;
}

function resolveMediaType(asset: ImageCacheAsset): string {
  return normalizeMediaType(asset.contentType) || normalizeMediaType(asset.blob.type) || 'application/octet-stream';
}

function inferImageExt(asset: ImageCacheAsset): string {
  const contentType = String(asset.contentType || asset.blob?.type || '')
    .trim()
    .toLowerCase();
  if (contentType.startsWith('image/')) return normalizeImageExt(contentType.slice('image/'.length));

  try {
    const url = new URL(String(asset.url || ''));
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

export type MaterializedConversationMarkdown = {
  markdown: string[];
  attachments: MaterializedExportAttachment[];
};

export async function materializeConversationMarkdownAssets(input: {
  conversationId: number;
  markdown: readonly string[];
  basename: string;
  nextAttachmentIndex: () => number;
}): Promise<MaterializedConversationMarkdown> {
  const markdown = Array.isArray(input.markdown) ? input.markdown.map((value) => String(value ?? '')) : [];
  const referencesByMarkdown: MarkdownImageReference[][] = [];
  const orderedAssetIds: number[] = [];
  const seenAssetIds = new Set<number>();

  for (const source of markdown) {
    referencesByMarkdown.push(collectMarkdownImageReferences(source));
    for (const assetId of collectOrderedSyncnosAssetIds(source)) {
      if (seenAssetIds.has(assetId)) continue;
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
    if (!asset || !(asset.blob instanceof Blob)) continue;
    const index = input.nextAttachmentIndex();
    const path = `attachments/${input.basename}-${String(index).padStart(4, '0')}.${inferImageExt(asset)}`;
    attachmentPathById.set(assetId, path);
    attachments.push({ path, blob: asset.blob, mediaType: resolveMediaType(asset), byteSize: asset.blob.size });
  }

  const rewritten = markdown.map((source, index) =>
    replaceMarkdownImageReferences(source, referencesByMarkdown[index] || [], (reference) => {
      if (!isSyncnosAssetUrl(reference.target)) return null;
      const assetId = parseSyncnosAssetId(reference.target);
      if (assetId == null) return { replacement: '[Image unavailable]' };
      const target = attachmentPathById.get(assetId);
      return target ? { target } : { replacement: '[Image unavailable]' };
    }),
  );

  return { markdown: rewritten, attachments };
}
