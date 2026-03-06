import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearNotionSyncJobStatus as defaultClearNotionSyncJobStatus,
  clearObsidianSyncStatus as defaultClearObsidianSyncStatus,
  getNotionSyncJobStatus as defaultGetNotionSyncJobStatus,
  getObsidianSyncStatus as defaultGetObsidianSyncStatus,
  syncNotionConversations as defaultSyncNotionConversations,
  syncObsidianConversations as defaultSyncObsidianConversations,
} from '../../sync/repo';
import { SYNC_JOB_STORAGE_KEYS } from '../../sync/sync-job-store';
import { storageOnChanged } from '../../platform/storage/local';
import type { SyncFailureSummary, SyncJobSnapshot, SyncJobStatusResponse, SyncProvider, SyncRunSummary } from '../../sync/models';

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
  clearNotionSyncJobStatus?: () => Promise<SyncJobStatusResponse>;
  clearObsidianSyncStatus?: () => Promise<SyncJobStatusResponse>;
  getNotionSyncJobStatus?: () => Promise<SyncJobStatusResponse>;
  getObsidianSyncStatus?: () => Promise<SyncJobStatusResponse>;
  syncNotionConversations?: (conversationIds: number[]) => Promise<SyncRunSummary>;
  syncObsidianConversations?: (conversationIds: number[]) => Promise<SyncRunSummary>;
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

function toFailureSummariesFromRows(rows: unknown): SyncFailureSummary[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row === 'object' && (row as any).ok === false)
    .map((row) => ({ conversationId: Number((row as any).conversationId) || 0, error: String((row as any).error || 'unknown error') }));
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

function buildAbortedMessage(job: SyncJobSnapshot) {
  const label = providerLabel(job.provider);
  const reason = String(job.abortedReason || '').trim();
  return reason ? `${label} sync stopped: ${reason}` : `${label} sync stopped`;
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

function toSummaryFromJob(job: SyncJobSnapshot): SyncRunSummary | null {
  if (!job || job.status === 'running') return null;
  return {
    provider: job.provider,
    okCount: Number(job.okCount) || 0,
    failCount: Number(job.failCount) || 0,
    failures: toFailureSummariesFromRows(job.perConversation),
    results: Array.isArray(job.perConversation) ? job.perConversation.slice() : [],
    jobId: job.id,
    instanceId: job.instanceId,
  };
}

function toFeedbackFromJob(job: SyncJobSnapshot): ConversationSyncFeedbackState {
  const completed = Math.max(
    Array.isArray(job.perConversation) ? job.perConversation.length : 0,
    (Number(job.okCount) || 0) + (Number(job.failCount) || 0),
  );
  const total = Math.max(completed, Array.isArray(job.conversationIds) ? job.conversationIds.length : 0);
  const failures = toFailureSummariesFromRows(job.perConversation);

  if (job.status === 'running') {
    return {
      provider: job.provider,
      phase: 'running',
      total,
      done: Math.min(completed, total || completed),
      failures,
      message: buildRunningMessage(job.provider, completed, total),
      updatedAt: Number(job.updatedAt) || Date.now(),
      summary: null,
    };
  }

  if (job.status === 'aborted') {
    return {
      provider: job.provider,
      phase: 'failed',
      total,
      done: Math.min(completed, total || completed),
      failures,
      message: buildAbortedMessage(job),
      updatedAt: Number(job.updatedAt) || Date.now(),
      summary: toSummaryFromJob(job),
    };
  }

  return toTerminalFeedback(
    {
      provider: job.provider,
      okCount: Number(job.okCount) || 0,
      failCount: Number(job.failCount) || 0,
      failures,
      results: Array.isArray(job.perConversation) ? job.perConversation.slice() : [],
      jobId: job.id,
      instanceId: job.instanceId,
    },
    total,
  );
}

function pickPrimaryJob(
  notionJob: SyncJobSnapshot | null,
  obsidianJob: SyncJobSnapshot | null,
  preferredProvider?: SyncProvider | null,
) {
  const jobs = [notionJob, obsidianJob].filter(Boolean) as SyncJobSnapshot[];
  if (!jobs.length) return null;

  const compare = (a: SyncJobSnapshot, b: SyncJobSnapshot) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  const running = jobs.filter((job) => job.status === 'running').sort(compare);
  if (preferredProvider) {
    const preferredRunning = running.find((job) => job.provider === preferredProvider);
    if (preferredRunning) return preferredRunning;
  }
  if (running.length) return running[0];

  const ordered = jobs.slice().sort(compare);
  if (preferredProvider) {
    const preferred = ordered.find((job) => job.provider === preferredProvider);
    if (preferred) return preferred;
  }
  return ordered[0];
}

function providerFromError(error: unknown): string {
  return String(error instanceof Error ? error.message : error || '').trim().toLowerCase();
}

export function useConversationSyncFeedback(deps: UseConversationSyncFeedbackDeps = {}) {
  const clearNotionSyncJobStatus = deps.clearNotionSyncJobStatus ?? defaultClearNotionSyncJobStatus;
  const clearObsidianSyncStatus = deps.clearObsidianSyncStatus ?? defaultClearObsidianSyncStatus;
  const getNotionSyncJobStatus = deps.getNotionSyncJobStatus ?? defaultGetNotionSyncJobStatus;
  const getObsidianSyncStatus = deps.getObsidianSyncStatus ?? defaultGetObsidianSyncStatus;
  const syncNotionConversations = deps.syncNotionConversations ?? defaultSyncNotionConversations;
  const syncObsidianConversations = deps.syncObsidianConversations ?? defaultSyncObsidianConversations;

  const [feedback, setFeedback] = useState<ConversationSyncFeedbackState>(IDLE_FEEDBACK);
  const disposedRef = useRef(false);

  const refreshFromBackground = useCallback(
    async (preferredProvider?: SyncProvider | null) => {
      const [notionStatus, obsidianStatus] = await Promise.all([
        getNotionSyncJobStatus().catch(() => ({ provider: 'notion', job: null } as SyncJobStatusResponse)),
        getObsidianSyncStatus().catch(() => ({ provider: 'obsidian', job: null } as SyncJobStatusResponse)),
      ]);
      if (disposedRef.current) return null;

      const job = pickPrimaryJob(notionStatus?.job ?? null, obsidianStatus?.job ?? null, preferredProvider);
      setFeedback(job ? toFeedbackFromJob(job) : IDLE_FEEDBACK);
      return job;
    },
    [getNotionSyncJobStatus, getObsidianSyncStatus],
  );

  useEffect(() => {
    disposedRef.current = false;
    void refreshFromBackground();
    return () => {
      disposedRef.current = true;
    };
  }, [refreshFromBackground]);

  useEffect(() => {
    const watchedKeys = new Set(Object.values(SYNC_JOB_STORAGE_KEYS));
    return storageOnChanged((changes, areaName) => {
      if (areaName !== 'local' || !changes || typeof changes !== 'object') return;
      const changed = Object.keys(changes).some((key) => watchedKeys.has(key));
      if (!changed) return;
      void refreshFromBackground(feedback.provider);
    });
  }, [feedback.provider, refreshFromBackground]);

  useEffect(() => {
    if (feedback.phase !== 'running' || !feedback.provider) return;
    const getStatus = feedback.provider === 'notion' ? getNotionSyncJobStatus : getObsidianSyncStatus;
    let disposed = false;

    const poll = async () => {
      try {
        const status = await getStatus();
        if (disposed || disposedRef.current) return;
        if (!status?.job) {
          await refreshFromBackground(feedback.provider);
          return;
        }
        setFeedback(toFeedbackFromJob(status.job));
      } catch (_error) {
        // Polling is best-effort; storage updates and sync completion still refresh the visible state.
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 500);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [feedback.phase, feedback.provider, getNotionSyncJobStatus, getObsidianSyncStatus, refreshFromBackground]);

  const clearFeedback = useCallback(() => {
    const current = feedback;
    if (current.phase === 'running') return;
    if (!current.provider) {
      setFeedback(IDLE_FEEDBACK);
      return;
    }

    setFeedback(IDLE_FEEDBACK);
    const clear = current.provider === 'notion' ? clearNotionSyncJobStatus : clearObsidianSyncStatus;
    void clear()
      .catch(() => undefined)
      .then(() => refreshFromBackground());
  }, [clearNotionSyncJobStatus, clearObsidianSyncStatus, feedback, refreshFromBackground]);

  const startSync = useCallback(
    async (provider: SyncProvider, conversationIds: number[]) => {
      const ids = normalizeIds(conversationIds);
      if (!ids.length) return null;

      setFeedback({
        provider,
        phase: 'running',
        total: ids.length,
        done: 0,
        failures: [],
        message: buildRunningMessage(provider, 0, ids.length),
        updatedAt: Date.now(),
        summary: null,
      });

      try {
        const summary = provider === 'notion'
          ? await syncNotionConversations(ids)
          : await syncObsidianConversations(ids);
        if (disposedRef.current) return summary;
        await refreshFromBackground(provider);
        return summary;
      } catch (error) {
        if (disposedRef.current) throw error;

        const message = providerFromError(error);
        if (message.includes('sync already in progress')) {
          await refreshFromBackground(provider);
          return null;
        }

        setFeedback({
          provider,
          phase: 'failed',
          total: 0,
          done: 0,
          failures: [{ conversationId: 0, error: error instanceof Error ? error.message : String(error || 'sync failed') }],
          message: toErrorMessage(provider, error),
          updatedAt: Date.now(),
          summary: null,
        });
        throw error;
      }
    },
    [refreshFromBackground, syncNotionConversations, syncObsidianConversations],
  );

  return {
    feedback,
    clearFeedback,
    startSync,
    syncingNotion: feedback.phase === 'running' && feedback.provider === 'notion',
    syncingObsidian: feedback.phase === 'running' && feedback.provider === 'obsidian',
  };
}
