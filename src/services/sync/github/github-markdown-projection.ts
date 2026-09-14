import type { ArticleCommentDto } from '@services/comments/domain/comment-dto';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { getImageCacheAssetsByIds, type ImageCacheAsset } from '@services/conversations/data/image-cache-read';
import { downloadChatgptImages } from '@services/integrations/chatgpt/api-image-assets';
import { sha256Hex } from '@services/sync/github/github-content-hash';
import {
  githubOutputFolderForConversation,
  isGithubManagedPathOwnedByConversation,
} from '@services/sync/github/github-managed-path-ownership';
import { collectOrderedSyncnosAssetIds } from '@services/shared/markdown-asset-refs';
import {
  collectMarkdownImageReferences,
  replaceMarkdownImageReferences,
} from '@services/shared/markdown-image-references';
import {
  buildChatgptFileCacheKey,
  chatgptFileIdFromUrl,
  hasChatgptFileScheme,
} from '@services/shared/chatgpt-image-identity';
import { isSyncnosAssetUrl, parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';
import { buildSyncnosObject } from '@services/sync/shared/remote-markdown-metadata';
import { buildFullNoteMarkdown } from '@services/sync/shared/remote-markdown-writer';

const GIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;

export type GithubProjectionManagedFile = {
  kind: 'markdown' | 'asset';
  contentHash: string;
  sha: string;
};

type GithubProjectionContinuity = {
  githubRemoteKey?: string;
  githubManagedFiles?: Record<string, GithubProjectionManagedFile>;
};

type GithubProjectionAttachment = {
  path: string;
  relativeTarget: string;
  contentHash: string;
  sha: string;
};

type GithubProjectionWarning = {
  code: 'image_missing' | 'image_upload_failed';
  assetId?: number;
  fileId?: string;
};

export type GithubMarkdownProjection = {
  markdownPath: string;
  markdownText: string;
  markdownContentHash: string;
  attachments: GithubProjectionAttachment[];
  projectionFingerprint: string;
  warnings: GithubProjectionWarning[];
};

type GithubImageBatchLoader = (input: {
  ids: readonly number[];
  conversationId: number;
}) => Promise<Map<number, ImageCacheAsset>>;
type GithubBlobUploader = (input: { content: Uint8Array }) => Promise<{ sha: string }>;

function normalizeImageExt(asset: Pick<ImageCacheAsset, 'contentType' | 'url'>): string {
  const contentType = String(asset.contentType || '')
    .trim()
    .toLowerCase()
    .split(';')[0]!;
  const subtype = contentType.startsWith('image/') ? contentType.slice('image/'.length) : '';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  if (subtype === 'x-icon' || subtype === 'vnd.microsoft.icon') return 'ico';
  if (/^[a-z0-9]{1,10}$/.test(subtype)) return subtype;

  try {
    const pathname = new URL(String(asset.url || '')).pathname;
    const filename = pathname.split('/').filter(Boolean).pop() || '';
    const dot = filename.lastIndexOf('.');
    const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
    if (ext === 'jpeg') return 'jpg';
    if (/^[a-z0-9]{1,10}$/.test(ext)) return ext;
  } catch (_error) {
    // Missing/opaque URLs do not affect content-addressed identity.
  }
  return 'png';
}

function publicFallbackUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function requireBlobSha(value: unknown): string {
  if (typeof value !== 'string' || !GIT_SHA_RE.test(value)) throw new Error('github_blob_response_invalid');
  return value.toLowerCase();
}

function managedFileEntries(
  continuity: GithubProjectionContinuity | undefined,
): Array<[string, GithubProjectionManagedFile]> {
  const files = continuity?.githubManagedFiles;
  if (!files || typeof files !== 'object') return [];
  return Object.entries(files)
    .filter((entry): entry is [string, GithubProjectionManagedFile] => {
      const row = entry[1] as GithubProjectionManagedFile;
      return (
        !!row &&
        row.kind === 'asset' &&
        CONTENT_HASH_RE.test(row.contentHash) &&
        typeof row.sha === 'string' &&
        GIT_SHA_RE.test(row.sha)
      );
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function findReusableAssetSha(
  continuity: GithubProjectionContinuity | undefined,
  remoteKey: string,
  path: string,
  contentHash: string,
  conversation: any,
): string | null {
  if (!remoteKey || !continuity || continuity.githubRemoteKey !== remoteKey) return null;
  const entries = managedFileEntries(continuity).filter(([candidatePath]) =>
    isGithubManagedPathOwnedByConversation(candidatePath, 'asset', conversation),
  );
  const exact = entries.find(([candidatePath, row]) => candidatePath === path && row.contentHash === contentHash);
  if (exact) return exact[1].sha.toLowerCase();
  const sameContent = entries.find(([, row]) => row.contentHash === contentHash);
  return sameContent ? sameContent[1].sha.toLowerCase() : null;
}

function attachmentNamespace(markdownPath: string): { fullPrefix: string; relativePrefix: string } {
  const slash = markdownPath.lastIndexOf('/');
  const dir = slash >= 0 ? markdownPath.slice(0, slash) : '';
  const filename = slash >= 0 ? markdownPath.slice(slash + 1) : markdownPath;
  const basename = filename.toLowerCase().endsWith('.md') ? filename.slice(0, -3) : filename;
  const relativePrefix = `${basename}.assets`;
  return { fullPrefix: dir ? `${dir}/${relativePrefix}` : relativePrefix, relativePrefix };
}

async function projectionFingerprint(
  markdownPath: string,
  markdownContentHash: string,
  attachments: readonly GithubProjectionAttachment[],
): Promise<string> {
  const assets = attachments
    .map((item) => ({ path: item.path, contentHash: item.contentHash }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256Hex(JSON.stringify({ markdown: { path: markdownPath, contentHash: markdownContentHash }, assets }));
}

export async function buildGithubMarkdownProjection(input: {
  conversation: any;
  messages: any[];
  comments?: ArticleCommentDto[];
  remoteKey?: string;
  continuity?: GithubProjectionContinuity;
  imageBatchLoader?: GithubImageBatchLoader;
  blobUploader?: GithubBlobUploader;
}): Promise<GithubMarkdownProjection> {
  const conversation = input.conversation || {};
  const folder = githubOutputFolderForConversation(conversation);
  const markdownPath = `${folder}/${buildConversationBasename(conversation)}.md`;
  const rawMarkdown = buildFullNoteMarkdown({
    conversation,
    messages: input.messages || [],
    comments: input.comments || [],
    syncnosObject: buildSyncnosObject({ conversation }),
    commentTimeZone: 'utc',
  });

  const references = collectMarkdownImageReferences(rawMarkdown);
  const assetIds = collectOrderedSyncnosAssetIds(rawMarkdown);
  const chatgptFileIds = Array.from(
    new Set(references.map((reference) => chatgptFileIdFromUrl(reference.target)).filter(Boolean)),
  );
  const conversationId = Number(conversation.id);
  if (assetIds.length && (!Number.isSafeInteger(conversationId) || conversationId <= 0)) {
    throw new Error('github_conversation_id_required');
  }

  const imageBatchLoader = input.imageBatchLoader ?? getImageCacheAssetsByIds;
  const blobUploader = input.blobUploader ?? null;
  if ((assetIds.length || chatgptFileIds.length) && !blobUploader) throw new Error('github_blob_uploader_required');

  const assetsById = assetIds.length ? await imageBatchLoader({ ids: assetIds, conversationId }) : new Map();
  const remoteKey = String(input.remoteKey || '');
  const namespace = attachmentNamespace(markdownPath);
  const replacementByAssetId = new Map<number, string>();
  const replacementByChatgptFileId = new Map<string, string>();
  const attachmentByPath = new Map<string, GithubProjectionAttachment>();
  const warnings: GithubProjectionWarning[] = [];

  const stageAttachment = async (source: {
    blob: Blob;
    contentType: string;
    url: string;
  }): Promise<{ target: string | null; uploadFailed: boolean }> => {
    const content = new Uint8Array(await source.blob.arrayBuffer());
    const contentHash = await sha256Hex(content);
    const ext = normalizeImageExt(source);
    const relativeTarget = `${namespace.relativePrefix}/${contentHash}.${ext}`;
    const path = `${namespace.fullPrefix}/${contentHash}.${ext}`;
    const duplicate = attachmentByPath.get(path);
    if (duplicate) return { target: duplicate.relativeTarget, uploadFailed: false };

    let sha = findReusableAssetSha(input.continuity, remoteKey, path, contentHash, conversation);
    if (!sha) {
      try {
        sha = requireBlobSha((await blobUploader!({ content })).sha);
      } catch (_error) {
        return { target: publicFallbackUrl(source.url), uploadFailed: true };
      }
    }

    attachmentByPath.set(path, { path, relativeTarget, contentHash, sha });
    return { target: relativeTarget, uploadFailed: false };
  };

  for (const assetId of assetIds) {
    const asset = assetsById.get(assetId) || null;
    if (!asset || !(asset.blob instanceof Blob)) {
      warnings.push({ code: 'image_missing', assetId });
      continue;
    }
    const staged = await stageAttachment({ blob: asset.blob, contentType: asset.contentType, url: asset.url });
    if (staged.target) replacementByAssetId.set(assetId, staged.target);
    if (staged.uploadFailed) warnings.push({ code: 'image_upload_failed', assetId });
  }

  if (chatgptFileIds.length) {
    const conversationKey =
      String(conversation.source || '')
        .trim()
        .toLowerCase() === 'chatgpt'
        ? String(conversation.conversationKey || '').trim()
        : '';
    if (!conversationKey) throw new Error('github_chatgpt_image_context_missing');
    const downloaded = await downloadChatgptImages({ conversationKey, fileIds: chatgptFileIds, concurrency: 4 });
    for (let index = 0; index < chatgptFileIds.length; index += 1) {
      const fileId = chatgptFileIds[index]!;
      const image = downloaded[index];
      if (!image?.ok) {
        warnings.push({ code: 'image_missing', fileId });
        continue;
      }
      const staged = await stageAttachment({
        blob: image.blob,
        contentType: image.contentType,
        url: buildChatgptFileCacheKey(fileId),
      });
      if (staged.target) replacementByChatgptFileId.set(fileId, staged.target);
      if (staged.uploadFailed) warnings.push({ code: 'image_upload_failed', fileId });
    }
  }

  const markdownText = replaceMarkdownImageReferences(rawMarkdown, references, (reference) => {
    if (isSyncnosAssetUrl(reference.target)) {
      const assetId = parseSyncnosAssetId(reference.target);
      const target = assetId != null ? replacementByAssetId.get(assetId) : null;
      return target ? { target } : null;
    }
    const fileId = chatgptFileIdFromUrl(reference.target);
    if (fileId) {
      const target = replacementByChatgptFileId.get(fileId);
      return target ? { target } : { replacement: '[Image unavailable]' };
    }
    if (hasChatgptFileScheme(reference.target)) return { replacement: '[Image unavailable]' };
    return null;
  });
  const hasUnresolvedInternalImage = collectMarkdownImageReferences(markdownText).some(
    (reference) => isSyncnosAssetUrl(reference.target) || hasChatgptFileScheme(reference.target),
  );
  if (hasUnresolvedInternalImage) throw new Error('github_internal_asset_ref_unresolved');

  const attachments = Array.from(attachmentByPath.values()).sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const markdownContentHash = await sha256Hex(markdownText);
  return {
    markdownPath,
    markdownText,
    markdownContentHash,
    attachments,
    projectionFingerprint: await projectionFingerprint(markdownPath, markdownContentHash, attachments),
    warnings,
  };
}
