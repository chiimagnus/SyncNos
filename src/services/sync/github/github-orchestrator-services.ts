import { backgroundStorage } from '@services/conversations/background/storage';
import { getImageCacheAssetById } from '@services/conversations/data/image-cache-read';
import {
  commitGithubStagedOperations,
  createGithubBlob,
  type GithubGitTransactionResult,
  type GithubStagedOperation,
} from '@services/sync/github/github-git-transport';
import {
  preflightGithubRepository,
  type GithubRepositoryPreflight,
} from '@services/sync/github/github-repository-service';
import { getGithubSettings, type GithubSettings } from '@services/sync/github/settings-store';

export type GithubOrchestratorStorage = {
  getSyncMappingByConversation: (conversationId: number) => Promise<{ conversation: any; mapping: any | null } | null>;
  getMessagesByConversationId: (conversationId: number) => Promise<any[]>;
  getArticleCommentsByConversationId: (conversationId: number) => Promise<any[]>;
  attachOrphanArticleCommentsToConversation: (canonicalUrl: string, conversationId: number) => Promise<unknown>;
  patchSyncMapping: (conversationId: number, patch: Record<string, unknown>) => Promise<unknown>;
};

export type GithubOrchestratorServices = {
  getSettings: () => Promise<GithubSettings>;
  preflight: (input: { repository: string; branch: string }) => Promise<GithubRepositoryPreflight>;
  storage: GithubOrchestratorStorage;
  loadImage: typeof getImageCacheAssetById;
  createBlob: (input: { repository: string; content: Uint8Array }) => Promise<{ sha: string }>;
  commit: (input: {
    repository: string;
    branch: string;
    operations: readonly GithubStagedOperation[];
    message: string;
  }) => Promise<GithubGitTransactionResult>;
  now: () => number;
};

export const defaultGithubOrchestratorServices: GithubOrchestratorServices = {
  getSettings: getGithubSettings,
  preflight: (input) => preflightGithubRepository(input),
  storage: backgroundStorage,
  loadImage: getImageCacheAssetById,
  createBlob: createGithubBlob,
  commit: ({ repository, branch, operations, message }) =>
    commitGithubStagedOperations({ repository, branch, operations, message }),
  now: Date.now,
};
