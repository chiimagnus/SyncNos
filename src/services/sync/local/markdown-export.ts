import { getConversationDetail } from '@services/conversations/client/repo';
import { getImageCacheAssetsByIds, type ImageCacheAsset } from '@services/conversations/data/image-cache-read';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { formatConversationMarkdown } from '@services/conversations/domain/markdown';
import type { Conversation } from '@services/conversations/domain/models';
import { collectMarkdownImageReferences, replaceMarkdownImageReferences } from '@services/shared/markdown-image-references';
import { buildLocalTimestampForFilename } from '@services/shared/file-timestamp';
import { isSyncnosAssetUrl, parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';
import { createZipBlob } from '@services/sync/backup/zip-utils';

function normalizeImageExt(raw: unknown): string {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'png';
  if (value === 'jpeg') return 'jpg';
  if (value === 'svg+xml') return 'svg';
  if (value === 'x-icon' || value === 'vnd.microsoft.icon') return 'ico';
  return /^[a-z0-9]+$/.test(value) ? value : 'png';
}

function inferImageExt(asset: ImageCacheAsset): string {
  const contentType = String(asset.contentType || asset.blob?.type || '').trim().toLowerCase();
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

type ExportAttachment = { name: string; data: Blob };
type MaterializedConversation = { markdown: string; attachments: ExportAttachment[] };

async function materializeConversationMarkdown(input: {
  conversationId: number;
  markdown: string;
  basename: string;
  nextAttachmentIndex: () => number;
}): Promise<MaterializedConversation> {
  const references = collectMarkdownImageReferences(input.markdown);
  const orderedAssetIds: number[] = [];
  const seen = new Set<number>();
  for (const reference of references) {
    if (!isSyncnosAssetUrl(reference.target)) continue;
    const assetId = parseSyncnosAssetId(reference.target);
    if (assetId == null || seen.has(assetId)) continue;
    seen.add(assetId);
    orderedAssetIds.push(assetId);
  }

  const assets = orderedAssetIds.length
    ? await getImageCacheAssetsByIds({ ids: orderedAssetIds, conversationId: input.conversationId })
    : new Map<number, ImageCacheAsset>();
  const attachmentNameById = new Map<number, string>();
  const attachments: ExportAttachment[] = [];
  for (const assetId of orderedAssetIds) {
    const asset = assets.get(assetId);
    if (!asset || !(asset.blob instanceof Blob)) continue;
    const index = input.nextAttachmentIndex();
    const name = `attachments/${input.basename}-${String(index).padStart(4, '0')}.${inferImageExt(asset)}`;
    attachmentNameById.set(assetId, name);
    attachments.push({ name, data: asset.blob });
  }

  const markdown = replaceMarkdownImageReferences(input.markdown, references, (reference) => {
    if (!isSyncnosAssetUrl(reference.target)) return null;
    const assetId = parseSyncnosAssetId(reference.target);
    if (assetId == null) return { replacement: '[Image unavailable]' };
    const target = attachmentNameById.get(assetId);
    return target ? { target } : { replacement: '[Image unavailable]' };
  });
  return { markdown, attachments };
}

export async function buildConversationsMarkdownZipExport({
  conversations,
  mergeSingle,
}: {
  conversations: Conversation[];
  mergeSingle: boolean;
}): Promise<{ zipBlob: Blob; filename: string }> {
  const list = (Array.isArray(conversations) ? conversations : []).filter((conversation) => {
    const id = Number(conversation?.id);
    return Number.isSafeInteger(id) && id > 0;
  });
  if (!list.length) throw new Error('No conversations selected');

  const stamp = buildLocalTimestampForFilename();
  const files: Array<{ name: string; data: string | Blob }> = [];
  let attachmentIndex = 0;
  const nextAttachmentIndex = () => {
    attachmentIndex += 1;
    return attachmentIndex;
  };
  const materialized: Array<{ conversation: Conversation; basename: string; markdown: string }> = [];

  for (const conversation of list) {
    const conversationId = Number(conversation.id);
    const detail = await getConversationDetail(conversationId);
    if (Number(detail?.conversationId) !== conversationId) throw new Error('conversation detail returned a mismatched id');
    const basename = buildConversationBasename(conversation);
    const result = await materializeConversationMarkdown({
      conversationId,
      basename,
      markdown: formatConversationMarkdown(conversation, detail.messages || []),
      nextAttachmentIndex,
    });
    materialized.push({ conversation, basename, markdown: result.markdown });
    files.push(...result.attachments);
  }

  if (mergeSingle) {
    files.unshift({ name: `SyncNos-md-${stamp}.md`, data: materialized.map((item) => item.markdown).join('\n---\n\n') });
  } else {
    for (let index = materialized.length - 1; index >= 0; index -= 1) {
      const item = materialized[index]!;
      files.unshift({ name: `${item.basename}.md`, data: item.markdown });
    }
  }

  return {
    zipBlob: await createZipBlob(files),
    filename: `SyncNos-md-${stamp}.zip`,
  };
}
