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
  abortRunningJobIfFromOtherInstance: (instanceId: string) => Promise<any>;
};

export type NotionConversationKinds = {
  pick: (input: { source?: unknown; sourceType?: unknown }) => any;
  getNotionStorageKeys?: () => string[];
};

export type NotionBackgroundStorage = {
  getSyncMappingByConversation: (conversationId: number) => Promise<any>;
  getMessagesByConversationId: (conversationId: number) => Promise<any[]>;
  setConversationNotionPageId?: (conversationId: number, pageId: string) => Promise<any>;
  setSyncCursor?: (conversationId: number, cursor: any) => Promise<any>;
  patchSyncMapping?: (conversationId: number, patch: Record<string, unknown>) => Promise<any>;
  getArticleCommentsByConversationId?: (conversationId: number) => Promise<any[]>;
  attachOrphanArticleCommentsToConversation?: (canonicalUrl: string, conversationId: number) => Promise<any>;
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
