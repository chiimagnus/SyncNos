import type { ArticleCommentDto } from '@services/comments/domain/comment-dto';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { getImageCacheAssetById, type ImageCacheAsset } from '@services/conversations/data/image-cache-read';
import { sha256Hex } from '@services/sync/github/github-content-hash';
import { isGithubManagedPathOwnedByConversation } from '@services/sync/github/github-managed-path-ownership';
import { GITHUB_OUTPUT_FOLDERS } from '@services/sync/github/settings-store';
import {
  collectOrderedSyncnosAssetIds,
  replaceSyncnosAssetImageReferences,
} from '@services/sync/shared/markdown-asset-refs';
import { buildSyncnosObject } from '@services/sync/shared/remote-markdown-metadata';
import { buildFullNoteMarkdown } from '@services/sync/shared/remote-markdown-writer';

const GIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;

export type GithubProjectionManagedFile = {
  kind: 'markdown' | 'asset';
  contentHash: string;
  sha: string;
};

export type GithubProjectionContinuity = {
  githubRemoteKey?: string;
  githubManagedFiles?: Record<string, GithubProjectionManagedFile>;
};

export type GithubProjectionAttachment = {
  path: string;
  relativeTarget: string;
  contentHash: string;
  sha: string;
};

export type GithubProjectionWarning = {
  code: 'image_missing' | 'image_upload_failed';
  assetId: number;
};

export type GithubMarkdownProjection = {
  markdownPath: string;
  markdownText: string;
  markdownContentHash: string;
  attachments: GithubProjectionAttachment[];
  projectionFingerprint: string;
  warnings: GithubProjectionWarning[];
};

export type GithubImageLoader = (input: { id: number; conversationId: number }) => Promise<ImageCacheAsset | null>;
export type GithubBlobUploader = (input: { content: Uint8Array }) => Promise<{ sha: string }>;

function folderForConversation(conversation: any): string {
  const sourceType = String(conversation?.sourceType || '').trim();
  if (sourceType === 'article') return GITHUB_OUTPUT_FOLDERS.article;
  if (sourceType === 'video') return GITHUB_OUTPUT_FOLDERS.video;
  return GITHUB_OUTPUT_FOLDERS.chat;
}

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
  imageLoader?: GithubImageLoader;
  blobUploader?: GithubBlobUploader;
}): Promise<GithubMarkdownProjection> {
  const conversation = input.conversation || {};
  const folder = folderForConversation(conversation);
  const markdownPath = `${folder}/${buildConversationBasename(conversation)}.md`;
  const rawMarkdown = buildFullNoteMarkdown({
    conversation,
    messages: input.messages || [],
    comments: input.comments || [],
    syncnosObject: buildSyncnosObject({ conversation }),
    commentTimeZone: 'utc',
  });

  const assetIds = collectOrderedSyncnosAssetIds(rawMarkdown);
  const conversationId = Number(conversation.id);
  if (assetIds.length && (!Number.isSafeInteger(conversationId) || conversationId <= 0)) {
    throw new Error('github_conversation_id_required');
  }

  const imageLoader = input.imageLoader ?? getImageCacheAssetById;
  const blobUploader = input.blobUploader ?? null;
  if (assetIds.length && !blobUploader) throw new Error('github_blob_uploader_required');

  const remoteKey = String(input.remoteKey || '');
  const namespace = attachmentNamespace(markdownPath);
  const replacementByAssetId = new Map<number, { target?: string; placeholder?: true }>();
  const attachmentByPath = new Map<string, GithubProjectionAttachment>();
  const warnings: GithubProjectionWarning[] = [];

  for (const assetId of assetIds) {
    const asset = await imageLoader({ id: assetId, conversationId });
    if (!asset || !(asset.blob instanceof Blob)) {
      replacementByAssetId.set(assetId, { placeholder: true });
      warnings.push({ code: 'image_missing', assetId });
      continue;
    }

    const content = new Uint8Array(await asset.blob.arrayBuffer());
    const contentHash = await sha256Hex(content);
    const ext = normalizeImageExt(asset);
    const relativeTarget = `${namespace.relativePrefix}/${contentHash}.${ext}`;
    const path = `${namespace.fullPrefix}/${contentHash}.${ext}`;
    const duplicate = attachmentByPath.get(path);
    if (duplicate) {
      replacementByAssetId.set(assetId, { target: duplicate.relativeTarget });
      continue;
    }

    let sha = findReusableAssetSha(input.continuity, remoteKey, path, contentHash, conversation);
    if (!sha) {
      try {
        sha = requireBlobSha((await blobUploader!({ content })).sha);
      } catch (_error) {
        const fallback = publicFallbackUrl(asset.url);
        if (fallback) replacementByAssetId.set(assetId, { target: fallback });
        else replacementByAssetId.set(assetId, { placeholder: true });
        warnings.push({ code: 'image_upload_failed', assetId });
        continue;
      }
    }

    const attachment = { path, relativeTarget, contentHash, sha };
    attachmentByPath.set(path, attachment);
    replacementByAssetId.set(assetId, { target: relativeTarget });
  }

  const markdownText = replaceSyncnosAssetImageReferences(rawMarkdown, ({ assetId }) => {
    const replacement = replacementByAssetId.get(assetId);
    if (!replacement) return null;
    if (replacement.placeholder) return { replacement: '[Image unavailable]' };
    return replacement.target ? { target: replacement.target } : null;
  });
  if (/syncnos-asset:\/\//i.test(markdownText)) throw new Error('github_internal_asset_ref_unresolved');

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
