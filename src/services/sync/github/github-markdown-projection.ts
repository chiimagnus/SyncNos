import type { ArticleCommentDto } from '@services/comments/domain/comment-dto';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { sha256Hex } from '@services/sync/github/github-content-hash';
import { GITHUB_DEFAULTS, normalizeGithubFolderPath, type GithubSettings } from '@services/sync/github/settings-store';
import { buildSyncnosObject } from '@services/sync/shared/remote-markdown-metadata';
import { buildFullNoteMarkdown } from '@services/sync/shared/remote-markdown-writer';

export type GithubProjectionFolders = Pick<GithubSettings, 'chatFolder' | 'articleFolder' | 'videoFolder'>;

export type GithubMarkdownProjection = {
  markdownPath: string;
  markdownText: string;
  markdownContentHash: string;
};

function folderForConversation(conversation: any, folders: GithubProjectionFolders): string {
  const sourceType = String(conversation?.sourceType || '').trim();
  if (sourceType === 'article') {
    return normalizeGithubFolderPath(folders.articleFolder, GITHUB_DEFAULTS.articleFolder, 'articleFolder');
  }
  if (sourceType === 'video') {
    return normalizeGithubFolderPath(folders.videoFolder, GITHUB_DEFAULTS.videoFolder, 'videoFolder');
  }
  return normalizeGithubFolderPath(folders.chatFolder, GITHUB_DEFAULTS.chatFolder, 'chatFolder');
}

export async function buildGithubMarkdownProjection(input: {
  conversation: any;
  messages: any[];
  comments?: ArticleCommentDto[];
  folders?: Partial<GithubProjectionFolders>;
}): Promise<GithubMarkdownProjection> {
  const conversation = input.conversation || {};
  const folders: GithubProjectionFolders = {
    chatFolder: input.folders?.chatFolder ?? GITHUB_DEFAULTS.chatFolder,
    articleFolder: input.folders?.articleFolder ?? GITHUB_DEFAULTS.articleFolder,
    videoFolder: input.folders?.videoFolder ?? GITHUB_DEFAULTS.videoFolder,
  };
  const folder = folderForConversation(conversation, folders);
  const markdownPath = `${folder}/${buildConversationBasename(conversation)}.md`;
  const markdownText = buildFullNoteMarkdown({
    conversation,
    messages: input.messages || [],
    comments: input.comments || [],
    syncnosObject: buildSyncnosObject({ conversation }),
    commentTimeZone: 'utc',
  });
  return {
    markdownPath,
    markdownText,
    markdownContentHash: await sha256Hex(markdownText),
  };
}
