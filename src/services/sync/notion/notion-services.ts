import type { JsonObject } from '@services/local-data/contracts';
import type { ResolvedConversationReference } from '@services/conversations/data/storage-native';
import type { ReconcileRunningSyncJobOptions } from '@services/sync/sync-job-store';

export type NotionToken = {
  accessToken: string;
  [key: string]: unknown;
};

export type NotionTokenStore = {
  getToken: () => Promise<NotionToken | null>;
};

export type NotionJobStore = {
  NOTION_SYNC_JOB_KEY: string;
  getJob?: () => Promise<any>;
  setJob: (job: any) => Promise<boolean>;
  isRunningJob: (job: any, staleMs?: number) => boolean;
  abortRunningJobIfFromOtherInstance: (
    instanceId: string,
    options?: number | ReconcileRunningSyncJobOptions,
  ) => Promise<any>;
};

export type NotionConversationKinds = {
  pick: (input: { source?: unknown; sourceType?: unknown }) => any;
  getNotionStorageKeys?: () => string[];
};

export type NotionBackgroundStorage = {
  getSyncMappingByConversation: (conversation: ResolvedConversationReference) => Promise<any>;
  getMessagesByConversation: (conversation: ResolvedConversationReference) => Promise<any[]>;
  setConversationNotionPageId: (
    conversation: ResolvedConversationReference,
    pageId: string,
    meta?: { notionPageUrl?: string; notionWorkspaceSlug?: string },
  ) => Promise<any>;
  setSyncCursor: (conversation: ResolvedConversationReference, cursor: JsonObject) => Promise<any>;
  patchSyncMapping: (conversation: ResolvedConversationReference, patch: JsonObject) => Promise<any>;
  getArticleCommentsByConversation: (conversation: ResolvedConversationReference) => Promise<unknown[]>;
  attachOrphanArticleCommentsToConversation: (
    canonicalUrl: string,
    conversation: ResolvedConversationReference,
  ) => Promise<any>;
};

export type NotionDbManager = {
  ensureDatabase: (input: {
    accessToken: string;
    parentPageId: string;
    dbSpec: any;
  }) => Promise<{ databaseId?: unknown }>;
  clearCachedDatabaseId?: (storageKey?: string) => Promise<any>;
  DEFAULT_DB_STORAGE_KEY?: string;
};

export type NotionSyncService = {
  getPage?: (accessToken: string, pageId: string) => Promise<any>;
  createPageInDatabase: (accessToken: string, input: any) => Promise<any>;
  updatePageProperties?: (accessToken: string, input: any) => Promise<any>;
  clearPageChildren?: (accessToken: string, pageId: string) => Promise<any>;
  appendChildren: (accessToken: string, pageId: string, blocks: any[]) => Promise<any>;
  messagesToBlocks: (messages: any[], input?: any) => any[];
  isPageUsableForDatabase?: (page: any, databaseId?: string) => boolean;
  pageBelongsToDatabase?: (page: any, databaseId: string) => boolean;
  hasExternalImageBlocks?: (blocks: any[]) => boolean;
  upgradeImageBlocksToFileUploads?: (accessToken: string, blocks: any[]) => Promise<any[]>;
};

export type NotionApi = Record<string, unknown>;
export type NotionFilesApi = Record<string, unknown>;

export type NotionServices = {
  tokenStore: NotionTokenStore;
  storage: NotionBackgroundStorage;
  conversationKinds: NotionConversationKinds;
  notionApi: NotionApi;
  notionFilesApi: NotionFilesApi;
  dbManager: NotionDbManager;
  syncService: NotionSyncService;
  jobStore: NotionJobStore;
};
