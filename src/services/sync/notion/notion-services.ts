import type { ArticleCommentDto } from '@services/comments/domain/comment-dto';
import type {
  ConversationKindDbSpec,
  ConversationKindDefinition,
} from '@services/protocols/conversation-kind-contract';
import type { SyncJobStore } from '@services/sync/sync-job-store';

type NotionToken = {
  accessToken: string;
  [key: string]: unknown;
};

type NotionTokenStore = {
  getToken: () => Promise<NotionToken | null>;
};

type NotionConversationKinds = {
  pick: (input: { source?: unknown; sourceType?: unknown }) => ConversationKindDefinition | null;
};

type NotionBackgroundStorage = {
  getSyncMappingByConversation: (conversationId: number) => Promise<any>;
  getMessagesByConversationId: (conversationId: number) => Promise<any[]>;
  setConversationNotionPageId: (
    conversationId: number,
    pageId: string,
    meta?: { notionPageUrl?: string; notionWorkspaceSlug?: string },
  ) => Promise<any>;
  setSyncCursor: (conversationId: number, cursor: any) => Promise<any>;
  patchSyncMapping: (conversationId: number, patch: Record<string, unknown>) => Promise<any>;
  getArticleCommentsByConversationId: (conversationId: number) => Promise<ArticleCommentDto[]>;
  attachOrphanArticleCommentsToConversation: (canonicalUrl: string, conversationId: number) => Promise<any>;
};

type NotionDbManager = {
  ensureDatabase: (input: {
    accessToken: string;
    parentPageId: string;
    dbSpec: ConversationKindDbSpec;
  }) => Promise<{ databaseId: string }>;
  clearCachedDatabaseId: (storageKey: string) => Promise<any>;
};

type NotionSyncService = {
  getPage: (accessToken: string, pageId: string) => Promise<any>;
  createPageInDatabase: (
    accessToken: string,
    input: { databaseId: string; properties: Record<string, unknown> },
  ) => Promise<any>;
  updatePageProperties: (
    accessToken: string,
    input: { pageId: string; properties: Record<string, unknown> },
  ) => Promise<any>;
  appendChildren: (accessToken: string, pageId: string, blocks: any[]) => Promise<{ results: any[]; count: number }>;
  messagesToBlocks: (messages: any[]) => any[];
  isPageUsableForDatabase: (page: any, databaseId: string) => boolean;
  upgradeImageBlocksToFileUploads: (accessToken: string, blocks: any[], conversationId: number) => Promise<any[]>;
};

export type NotionServices = {
  tokenStore: NotionTokenStore;
  storage: NotionBackgroundStorage;
  conversationKinds: NotionConversationKinds;
  dbManager: NotionDbManager;
  syncService: NotionSyncService;
  jobStore: SyncJobStore;
};
