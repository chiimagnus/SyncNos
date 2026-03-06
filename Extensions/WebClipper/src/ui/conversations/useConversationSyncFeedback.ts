import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getNotionSyncJobStatus as defaultGetNotionSyncJobStatus,
  getObsidianSyncStatus as defaultGetObsidianSyncStatus,
  syncNotionConversations as defaultSyncNotionConversations,
  syncObsidianConversations as defaultSyncObsidianConversations,
} from '../../sync/repo';
import type { SyncFailureSummary, SyncJobStatusResponse, SyncProvider, SyncRunSummary } from '../../sync/models';

export type ConversationSyncFeedbackPhase = 'idle' | 'running' | 'success' | 'partial-failed' | 'failed';

export type ConversationSyncFeedbackState = {
  provider: SyncProvider | null;
  phase: ConversationSyncFeedbackPhase;
  total: number;
  done: number;
  failures: SyncFailureSummary[];
  message: string;
  updatedAt: number;
  summary: SyncRunSummary | null;
};

type UseConversationSyncFeedbackDeps = {
  getNotionSyncJobStatus?: () => Promise<SyncJobStatusResponse>;
  getObsidianSyncStatus?: () => Promise<SyncJobStatusResponse>;
  syncNotionConversations?: (conversationIds: number[]) => Promise<SyncRunSummary>;
  syncObsidianConversations?: (conversationIds: number[]) => Promise<SyncRunSummary>;
};

type ActiveRun = {
  provider: SyncProvider;
  token: number;
  total: number;
};

const IDLE_FEEDBACK: ConversationSyncFeedbackState = {
  provider: null,
  phase: 'idle',
  total: 0,
  done: 0,
  failures: [],
  message: '',
  updatedAt: 0,
  summary: null,
};

function providerLabel(provider: SyncProvider) {
  return provider === 'notion' ? 'Notion' : 'Obsidian';
}

function normalizeIds(ids: number[]) {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
}

function buildRunningMessage(provider: SyncProvider, done: number, total: number) {
  const label = providerLabel(provider);
  if (total > 0) return `${label} syncing ${Math.min(done, total)}/${total}`;
  return `${label} syncing`;
}

function buildFinishedMessage(summary: SyncRunSummary, total: number) {
  const label = providerLabel(summary.provider);
  const safeTotal = Math.max(total, summary.results.length, summary.okCount + summary.failCount);
  if (summary.failCount <= 0) return `${label} sync completed (${summary.okCount}/${safeTotal})`;
  if (summary.okCount > 0) return `${label} sync partially failed (${summary.failCount}/${safeTotal} failed)`;
  return `${label} sync failed (${summary.failCount}/${safeTotal})`;
}

function toFailureSummaries(summary: SyncRunSummary) {
  if (Array.isArray(summary.failures) && summary.failures.length) return summary.failures;
  return summary.results
    .filter((result) => !result.ok)
    .map((result) => ({ conversationId: Number(result.conversationId) || 0, error: String(result.error || 'unknown error') }));
}

function toTerminalFeedback(summary: SyncRunSummary, total: number): ConversationSyncFeedbackState {
  const failures = toFailureSummaries(summary);
  const safeTotal = Math.max(total, summary.results.length, summary.okCount + summary.failCount);
  const phase: ConversationSyncFeedbackPhase = summary.failCount <= 0
    ? 'success'
    : summary.okCount > 0
      ? 'partial-failed'
      : 'failed';

  return {
    provider: summary.provider,
    phase,
    total: safeTotal,
    done: safeTotal,
    failures,
    message: buildFinishedMessage(summary, safeTotal),
    updatedAt: Date.now(),
    summary,
  };
}

function toErrorMessage(provider: SyncProvider, error: unknown) {
  const label = providerLabel(provider);
  const text = error instanceof Error ? error.message : String(error || '').trim();
  return text ? `${label} sync failed: ${text}` : `${label} sync failed`;
}

export function useConversationSyncFeedback(deps: UseConversationSyncFeedbackDeps = {}) {
  const getNotionSyncJobStatus = deps.getNotionSyncJobStatus ?? defaultGetNotionSyncJobStatus;
  const getObsidianSyncStatus = deps.getObsidianSyncStatus ?? defaultGetObsidianSyncStatus;
  const syncNotionConversations = deps.syncNotionConversations ?? defaultSyncNotionConversations;
  const syncObsidianConversations = deps.syncObsidianConversations ?? defaultSyncObsidianConversations;

  const [feedback, setFeedback] = useState<ConversationSyncFeedbackState>(IDLE_FEEDBACK);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const runTokenRef = useRef(0);

  const clearFeedback = useCallback(() => {
    setFeedback((current) => (current.phase === 'running' ? current : IDLE_FEEDBACK));
  }, []);

  useEffect(() => {
    if (!activeRun) return;

    const token = activeRun.token;
    const provider = activeRun.provider;
    const getStatus = provider === 'notion' ? getNotionSyncJobStatus : getObsidianSyncStatus;
    let disposed = false;

    const poll = async () => {
      try {
        const status = await getStatus();
        if (disposed || runTokenRef.current !== token) return;
        const job = status?.job;
        if (!job) return;

        const total = Math.max(activeRun.total, Array.isArray(job.conversationIds) ? job.conversationIds.length : 0);
        const done = Array.isArray(job.perConversation) ? job.perConversation.length : 0;
        const failures = Array.isArray(job.perConversation)
          ? job.perConversation
              .filter((row) => row && row.ok === false)
              .map((row) => ({ conversationId: Number(row.conversationId) || 0, error: String(row.error || 'unknown error') }))
          : [];

        setFeedback((current) => {
          if (current.phase !== 'running' || current.provider !== provider) return current;
          return {
            ...current,
            total,
            done,
            failures,
            updatedAt: Date.now(),
            message: buildRunningMessage(provider, done, total),
          };
        });

        if (job.status !== 'running') setActiveRun((current) => (current?.token === token ? null : current));
      } catch (_error) {
        // Polling is best-effort; final state still comes from the main sync promise.
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 400);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeRun, getNotionSyncJobStatus, getObsidianSyncStatus]);

  const startSync = useCallback(
    async (provider: SyncProvider, conversationIds: number[]) => {
      const ids = normalizeIds(conversationIds);
      if (!ids.length) return null;

      const token = runTokenRef.current + 1;
      runTokenRef.current = token;
      const total = ids.length;

      setActiveRun({ provider, token, total });
      setFeedback({
        provider,
        phase: 'running',
        total,
        done: 0,
        failures: [],
        message: buildRunningMessage(provider, 0, total),
        updatedAt: Date.now(),
        summary: null,
      });

      try {
        const summary = provider === 'notion'
          ? await syncNotionConversations(ids)
          : await syncObsidianConversations(ids);
        if (runTokenRef.current !== token) return summary;

        setActiveRun((current) => (current?.token === token ? null : current));
        setFeedback(toTerminalFeedback(summary, total));
        return summary;
      } catch (error) {
        if (runTokenRef.current !== token) throw error;

        setActiveRun((current) => (current?.token === token ? null : current));
        setFeedback({
          provider,
          phase: 'failed',
          total,
          done: 0,
          failures: [{ conversationId: 0, error: error instanceof Error ? error.message : String(error || 'sync failed') }],
          message: toErrorMessage(provider, error),
          updatedAt: Date.now(),
          summary: null,
        });
        throw error;
      }
    },
    [syncNotionConversations, syncObsidianConversations],
  );

  return {
    feedback,
    clearFeedback,
    startSync,
    syncingNotion: feedback.phase === 'running' && feedback.provider === 'notion',
    syncingObsidian: feedback.phase === 'running' && feedback.provider === 'obsidian',
  };
}
