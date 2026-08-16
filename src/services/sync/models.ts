import type { StableConversationReference } from '@services/local-data/contracts';

export type SyncProvider = 'notion' | 'obsidian' | 'feishu';

export type SyncJobPhase = 'running' | 'done' | 'aborted';

export type SyncConversationReference = StableConversationReference &
  Readonly<{
    conversationId?: number;
  }>;

export type SyncFailureSummary = {
  conversationId: number;
  conversationTitle?: string;
  error: string;
  reference?: SyncConversationReference;
};

export type SyncWarning = {
  code: string;
  message: string;
  extra?: unknown;
};

export type SyncPerConversationResult = {
  conversationId: number;
  conversationTitle?: string;
  reference?: SyncConversationReference;
  ok: boolean;
  mode: string;
  appended: number;
  error: string;
  warnings?: SyncWarning[];
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
  conversations: SyncConversationReference[];
  conversationIds: number[];
  currentConversation?: SyncConversationReference;
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
