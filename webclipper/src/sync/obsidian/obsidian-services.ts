export type ObsidianConnectionConfig = {
  apiBaseUrl?: string;
  apiKey?: string;
  authHeaderName?: string;
};

export type ObsidianPathConfig = {
  chatFolder?: string;
  articleFolder?: string;
};

export type ObsidianSettingsStore = {
  getConnectionConfig: () => Promise<ObsidianConnectionConfig>;
  getPathConfig: () => Promise<ObsidianPathConfig>;
};

export type ObsidianLocalRestClientModule = {
  NOTE_JSON_ACCEPT?: string;
  createClient: (input: ObsidianConnectionConfig) => any;
};

export type ObsidianNotePathModule = {
  buildStableNotePath: (input: any) => string;
  buildLegacyHashNotePath?: (input: any) => string;
  stableConversationId10?: (input: any) => string;
  resolveExistingNotePath?: (input: any) => Promise<any>;
};

export type ObsidianSyncMetadataModule = {
  readSyncnosObject: (frontmatter: unknown) => any;
  buildSyncnosObject: (input: any) => any;
};

export type ObsidianMarkdownWriterModule = {
  buildFullNoteMarkdown: (input: any) => string;
  buildIncrementalAppendMarkdown: (input: any) => string;
  appendUnderMessagesHeading: (input: any) => Promise<any>;
  replaceSyncnosFrontmatter: (input: any) => Promise<any>;
};

export type ObsidianSyncOrchestrator = {
  testConnection: (input: { instanceId: string }) => Promise<any>;
  getSyncStatus: (input: { instanceId: string }) => Promise<any>;
  syncConversations: (input: {
    conversationIds?: unknown[];
    forceFullConversationIds?: unknown[];
    instanceId: string;
  }) => Promise<any>;
};

export type ObsidianServices = {
  settingsStore: ObsidianSettingsStore;
  localRestClient: ObsidianLocalRestClientModule;
  markdownWriter: ObsidianMarkdownWriterModule;
  metadata: ObsidianSyncMetadataModule;
  notePath: ObsidianNotePathModule;
  syncOrchestrator: ObsidianSyncOrchestrator;
};
