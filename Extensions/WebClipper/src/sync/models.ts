export type SyncProvider = 'notion' | 'obsidian';

export type SyncJobPhase = 'running' | 'done' | 'aborted';

export type SyncFailureSummary = {
  conversationId: number;
  error: string;
};

export type SyncPerConversationResult = {
  conversationId: number;
  ok: boolean;
  mode: string;
  appended: number;
  error: string;
  at: number;
};

export type SyncRunSummary = {
  provider: SyncProvider;
  okCount: number;
  failCount: number;
  failures: SyncFailureSummary[];
  results: SyncPerConversationResult[];
  jobId?: string;
  instanceId?: string;
};

export type SyncJobSnapshot = {
  id?: string;
  provider: SyncProvider;
  instanceId?: string;
  status: SyncJobPhase;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  conversationIds: number[];
  currentConversationId?: number;
  currentConversationTitle?: string;
  currentStage?: string;
  okCount: number;
  failCount: number;
  perConversation: SyncPerConversationResult[];
  abortedReason?: string;
};

export type SyncJobStatusResponse = {
  provider: SyncProvider;
  job: SyncJobSnapshot | null;
  instanceId?: string;
};

export type NotionSyncJobStatus = SyncJobStatusResponse;

export type ObsidianSyncStatus = SyncJobStatusResponse;
