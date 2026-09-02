import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearFeishuSyncStatus as defaultClearFeishuSyncStatus,
  clearGithubSyncStatus as defaultClearGithubSyncStatus,
  clearNotionSyncJobStatus as defaultClearNotionSyncJobStatus,
  clearObsidianSyncStatus as defaultClearObsidianSyncStatus,
  getFeishuSyncStatus as defaultGetFeishuSyncStatus,
  getGithubSyncStatus as defaultGetGithubSyncStatus,
  getNotionSyncJobStatus as defaultGetNotionSyncJobStatus,
  getObsidianSyncStatus as defaultGetObsidianSyncStatus,
  syncFeishuConversations as defaultSyncFeishuConversations,
  syncGithubConversations as defaultSyncGithubConversations,
  syncNotionConversations as defaultSyncNotionConversations,
  syncObsidianConversations as defaultSyncObsidianConversations,
} from '@services/sync/repo';
import { SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-store';
import { storageOnChanged } from '@services/shared/storage';
import type {
  SyncFailureSummary,
  SyncJobSnapshot,
  SyncJobStatusResponse,
  SyncProvider,
  SyncRunSummary,
  SyncWarning,
} from '@services/sync/models';
import type { SyncStartAck } from '@services/sync/repo';
import { t } from '@i18n';
import { getSyncProviderDefinition } from '@services/sync/sync-provider-registry';

export type ConversationSyncFeedbackPhase = 'idle' | 'running' | 'success' | 'partial-failed' | 'failed';

export type ConversationSyncFeedbackState = {
  provider: SyncProvider | null;
  phase: ConversationSyncFeedbackPhase;
  total: number;
  done: number;
  currentConversationId: number | null;
  currentConversationTitle: string;
  currentStage: string;
  failures: SyncFailureSummary[];
  warnings: SyncWarningSummary[];
  message: string;
  updatedAt: number;
  summary: SyncRunSummary | null;
};

type UseConversationSyncFeedbackDeps = {
  clearFeishuSyncStatus?: () => Promise<SyncJobStatusResponse>;
  clearGithubSyncStatus?: () => Promise<SyncJobStatusResponse>;
  clearNotionSyncJobStatus?: () => Promise<SyncJobStatusResponse>;
  clearObsidianSyncStatus?: () => Promise<SyncJobStatusResponse>;
  getFeishuSyncStatus?: () => Promise<SyncJobStatusResponse>;
  getGithubSyncStatus?: () => Promise<SyncJobStatusResponse>;
  getNotionSyncJobStatus?: () => Promise<SyncJobStatusResponse>;
  getObsidianSyncStatus?: () => Promise<SyncJobStatusResponse>;
  syncFeishuConversations?: (conversationIds: number[]) => Promise<SyncStartAck>;
  syncGithubConversations?: (conversationIds: number[]) => Promise<SyncStartAck>;
  syncNotionConversations?: (conversationIds: number[]) => Promise<SyncStartAck>;
  syncObsidianConversations?: (conversationIds: number[]) => Promise<SyncStartAck>;
};

type ActiveRun = {
  provider: SyncProvider;
  token: number;
};

const IDLE_FEEDBACK: ConversationSyncFeedbackState = {
  provider: null,
  phase: 'idle',
  total: 0,
  done: 0,
  currentConversationId: null,
  currentConversationTitle: '',
  currentStage: '',
  failures: [],
  warnings: [],
  message: '',
  updatedAt: 0,
  summary: null,
};

function providerLabel(provider: SyncProvider) {
  const definition = getSyncProviderDefinition(provider);
  const labelKey = definition?.labelKey;
  const label = labelKey ? t(labelKey as any) : '';
  return label || String(provider || '');
}

function normalizeIds(ids: number[]) {
  return Array.from(
    new Set((Array.isArray(ids) ? ids : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
  );
}

function toFailureSummariesFromRows(rows: unknown): SyncFailureSummary[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row === 'object' && (row as any).ok === false)
    .map((row) => ({
      conversationId: Number((row as any).conversationId) || 0,
      conversationTitle: String((row as any).conversationTitle || '').trim(),
      error: String((row as any).error || 'unknown error'),
    }));
}

export type SyncWarningSummary = {
  conversationId: number;
  conversationTitle?: string;
  code: string;
  message: string;
  extra?: unknown;
};

function toWarningSummariesFromRows(rows: unknown): SyncWarningSummary[] {
  if (!Array.isArray(rows)) return [];
  const out: SyncWarningSummary[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const conversationId = Number((row as any).conversationId) || 0;
    const warnings = (row as any).warnings;
    if (!Array.isArray(warnings) || !warnings.length) continue;
    for (const w of warnings as SyncWarning[]) {
      if (!w || typeof w !== 'object') continue;
      const conversationTitle = String((row as any).conversationTitle || '').trim();
      const code = String((w as any).code || '').trim() || 'warning';
      const message = String((w as any).message || '').trim() || code;
      const extra = (w as any).extra;
      out.push({ conversationId, conversationTitle, code, message, extra });
    }
  }
  return out;
}

function buildRunningMessage(provider: SyncProvider, done: number, total: number) {
  const label = providerLabel(provider);
  if (total > 0) return `${label} · ${t('phaseRunning')} ${Math.min(done, total)}/${total}`;
  return `${label} · ${t('phaseRunning')}`;
}

function buildFinishedMessage(summary: SyncRunSummary, total: number) {
  const label = providerLabel(summary.provider);
  const safeTotal = Math.max(total, summary.results.length, summary.okCount + summary.failCount);
  if (summary.failCount <= 0) return `${label} · ${t('phaseSuccess')} (${summary.okCount}/${safeTotal})`;
  if (summary.okCount > 0) return `${label} · ${t('phasePartialFailed')} (${summary.failCount}/${safeTotal})`;
  return `${label} · ${t('phaseFailed')} (${summary.failCount}/${safeTotal})`;
}

function buildAbortedMessage(job: SyncJobSnapshot) {
  const label = providerLabel(job.provider);
  const reason = String(job.abortedReason || '').trim();
  return reason ? `${label} · ${t('syncStopped')}: ${reason}` : `${label} · ${t('syncStopped')}`;
}

function toFailureSummaries(summary: SyncRunSummary) {
  if (Array.isArray(summary.failures) && summary.failures.length) return summary.failures;
  return summary.results
    .filter((result) => !result.ok)
    .map((result) => ({
      conversationId: Number(result.conversationId) || 0,
      conversationTitle: String(result.conversationTitle || '').trim(),
      error: String(result.error || 'unknown error'),
    }));
}

function toWarningSummaries(summary: SyncRunSummary) {
  return toWarningSummariesFromRows(summary.results);
}

function toTerminalFeedback(summary: SyncRunSummary, total: number): ConversationSyncFeedbackState {
  const failures = toFailureSummaries(summary);
  const warnings = toWarningSummaries(summary);
  const safeTotal = Math.max(total, summary.results.length, summary.okCount + summary.failCount);
  const phase: ConversationSyncFeedbackPhase =
    summary.failCount <= 0 ? 'success' : summary.okCount > 0 ? 'partial-failed' : 'failed';

  return {
    provider: summary.provider,
    phase,
    total: safeTotal,
    done: safeTotal,
    currentConversationId: null,
    currentConversationTitle: '',
    currentStage: '',
    failures,
    warnings,
    message: buildFinishedMessage(summary, safeTotal),
    updatedAt: Date.now(),
    summary,
  };
}

function toErrorMessage(provider: SyncProvider, error: unknown) {
  const label = providerLabel(provider);
  const text = error instanceof Error ? error.message : String(error || '').trim();
  return text ? `${label} · ${t('phaseFailed')}: ${text}` : `${label} · ${t('phaseFailed')}`;
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
  const total = Math.max(
    completed,
    Number.isSafeInteger(job.totalCount) && Number(job.totalCount) >= 0 ? Number(job.totalCount) : 0,
    Array.isArray(job.conversationIds) ? job.conversationIds.length : 0,
  );
  const failures = toFailureSummariesFromRows(job.perConversation);
  const warnings = toWarningSummariesFromRows(job.perConversation);

  if (job.status === 'running') {
    return {
      provider: job.provider,
      phase: 'running',
      total,
      done: Math.min(completed, total || completed),
      currentConversationId: Number(job.currentConversationId) || null,
      currentConversationTitle: String(job.currentConversationTitle || ''),
      currentStage: String(job.currentStage || ''),
      failures,
      warnings,
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
      currentConversationId: Number(job.currentConversationId) || null,
      currentConversationTitle: String(job.currentConversationTitle || ''),
      currentStage: String(job.currentStage || ''),
      failures,
      warnings,
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

function pickPrimaryJob(jobsInput: Array<SyncJobSnapshot | null>, preferredProvider?: SyncProvider | null) {
  const jobs = jobsInput.filter(Boolean) as SyncJobSnapshot[];
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

function assertNever(value: never): never {
  throw new Error(`unsupported sync provider: ${String(value)}`);
}

function errorCode(error: unknown): string {
  return String((error as any)?.extra?.code ?? (error as any)?.code ?? '')
    .trim()
    .toLowerCase();
}

export function useConversationSyncFeedback(deps: UseConversationSyncFeedbackDeps = {}) {
  const clearFeishuSyncStatus = deps.clearFeishuSyncStatus ?? defaultClearFeishuSyncStatus;
  const clearGithubSyncStatus = deps.clearGithubSyncStatus ?? defaultClearGithubSyncStatus;
  const clearNotionSyncJobStatus = deps.clearNotionSyncJobStatus ?? defaultClearNotionSyncJobStatus;
  const clearObsidianSyncStatus = deps.clearObsidianSyncStatus ?? defaultClearObsidianSyncStatus;
  const getFeishuSyncStatus = deps.getFeishuSyncStatus ?? defaultGetFeishuSyncStatus;
  const getGithubSyncStatus = deps.getGithubSyncStatus ?? defaultGetGithubSyncStatus;
  const getNotionSyncJobStatus = deps.getNotionSyncJobStatus ?? defaultGetNotionSyncJobStatus;
  const getObsidianSyncStatus = deps.getObsidianSyncStatus ?? defaultGetObsidianSyncStatus;
  const syncFeishuConversations = deps.syncFeishuConversations ?? defaultSyncFeishuConversations;
  const syncGithubConversations = deps.syncGithubConversations ?? defaultSyncGithubConversations;
  const syncNotionConversations = deps.syncNotionConversations ?? defaultSyncNotionConversations;
  const syncObsidianConversations = deps.syncObsidianConversations ?? defaultSyncObsidianConversations;

  const [feedback, setFeedback] = useState<ConversationSyncFeedbackState>(IDLE_FEEDBACK);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const disposedRef = useRef(false);
  const runTokenRef = useRef(0);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const feedbackRef = useRef<ConversationSyncFeedbackState>(IDLE_FEEDBACK);

  useEffect(() => {
    activeRunRef.current = activeRun;
  }, [activeRun]);

  useEffect(() => {
    feedbackRef.current = feedback;
  }, [feedback]);

  const refreshFromBackground = useCallback(
    async (preferredProvider?: SyncProvider | null) => {
      const [notionStatus, obsidianStatus, feishuStatus, githubStatus] = await Promise.all([
        getNotionSyncJobStatus().catch(() => ({ provider: 'notion', job: null }) as SyncJobStatusResponse),
        getObsidianSyncStatus().catch(() => ({ provider: 'obsidian', job: null }) as SyncJobStatusResponse),
        getFeishuSyncStatus().catch(() => ({ provider: 'feishu', job: null }) as SyncJobStatusResponse),
        getGithubSyncStatus().catch(() => ({ provider: 'github', job: null }) as SyncJobStatusResponse),
      ]);
      if (disposedRef.current) return null;

      const job = pickPrimaryJob(
        [notionStatus?.job ?? null, obsidianStatus?.job ?? null, feishuStatus?.job ?? null, githubStatus?.job ?? null],
        preferredProvider,
      );
      if (job?.status === 'running') {
        setActiveRun((current) => {
          if (current?.provider === job.provider) return current;
          const token = runTokenRef.current + 1;
          runTokenRef.current = token;
          return { provider: job.provider, token };
        });
      } else if (job) {
        runTokenRef.current += 1;
        setActiveRun(null);
      } else if (activeRunRef.current && feedbackRef.current.phase === 'running') {
        // Preserve the current running state when a transient status read returns no job,
        // allowing the polling loop and storage change refreshes to continue without interruption.
      } else {
        runTokenRef.current += 1;
        setActiveRun(null);
      }
      setFeedback((current) => {
        if (job) return toFeedbackFromJob(job);
        if (current.phase === 'running') return current;
        if (current.phase === 'failed' && current.summary == null) return current;
        return IDLE_FEEDBACK;
      });
      return job;
    },
    [getNotionSyncJobStatus, getObsidianSyncStatus, getFeishuSyncStatus, getGithubSyncStatus],
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
    if (!activeRun) return;
    const token = activeRun.token;
    const provider = activeRun.provider;
    const getStatus = (() => {
      switch (provider) {
        case 'notion':
          return getNotionSyncJobStatus;
        case 'obsidian':
          return getObsidianSyncStatus;
        case 'feishu':
          return getFeishuSyncStatus;
        case 'github':
          return getGithubSyncStatus;
        default:
          return assertNever(provider);
      }
    })();
    let disposed = false;

    const poll = async () => {
      try {
        const status = await getStatus();
        if (disposed || disposedRef.current || runTokenRef.current !== token) return;
        if (!status?.job) {
          await refreshFromBackground(provider);
          return;
        }
        setFeedback((current) => {
          if (current.phase !== 'running' || current.provider !== provider) return current;
          return toFeedbackFromJob(status.job!);
        });
        if (status.job.status !== 'running') {
          runTokenRef.current += 1;
          setActiveRun((current) => (current?.token === token ? null : current));
        }
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
  }, [
    activeRun,
    getNotionSyncJobStatus,
    getObsidianSyncStatus,
    getFeishuSyncStatus,
    getGithubSyncStatus,
    refreshFromBackground,
  ]);

  const clearFeedback = useCallback(() => {
    const current = feedback;
    if (current.phase === 'running') return;
    if (!current.provider) {
      setFeedback(IDLE_FEEDBACK);
      return;
    }

    setFeedback(IDLE_FEEDBACK);
    const clear = (() => {
      switch (current.provider) {
        case 'notion':
          return clearNotionSyncJobStatus;
        case 'obsidian':
          return clearObsidianSyncStatus;
        case 'feishu':
          return clearFeishuSyncStatus;
        case 'github':
          return clearGithubSyncStatus;
        default:
          return assertNever(current.provider);
      }
    })();
    void clear()
      .catch(() => undefined)
      .then(() => refreshFromBackground());
  }, [
    clearNotionSyncJobStatus,
    clearObsidianSyncStatus,
    clearFeishuSyncStatus,
    clearGithubSyncStatus,
    feedback,
    refreshFromBackground,
  ]);

  const startSync = useCallback(
    async (provider: SyncProvider, conversationIds: number[]): Promise<SyncStartAck | null> => {
      const ids = normalizeIds(conversationIds);
      if (!ids.length) return null;

      if (provider === 'obsidian') {
        const token = runTokenRef.current + 1;
        runTokenRef.current = token;

        try {
          const ack = await syncObsidianConversations(ids);
          if (disposedRef.current) return ack;

          const nextRun: ActiveRun = { provider, token };
          activeRunRef.current = nextRun;
          setActiveRun(nextRun);

          const runningFeedback: ConversationSyncFeedbackState = {
            provider,
            phase: 'running',
            total: ids.length,
            done: 0,
            currentConversationId: null,
            currentConversationTitle: '',
            currentStage: 'preparing_queue',
            failures: [],
            warnings: [],
            message: buildRunningMessage(provider, 0, ids.length),
            updatedAt: Date.now(),
            summary: null,
          };
          feedbackRef.current = runningFeedback;
          setFeedback(runningFeedback);

          await refreshFromBackground(provider);
          return ack;
        } catch (error) {
          if (disposedRef.current) throw error;

          const code = errorCode(error);
          if (code === 'sync_already_running') {
            await refreshFromBackground(provider);
            return null;
          }

          const disabledByGate = code === 'sync_provider_disabled';
          const failureText = disabledByGate
            ? t('syncProviderDisabled')
            : error instanceof Error
              ? error.message
              : String(error || 'sync failed');
          const message = disabledByGate
            ? `${providerLabel(provider)} · ${t('phaseFailed')}: ${t('syncProviderDisabled')}`
            : toErrorMessage(provider, error);

          runTokenRef.current += 1;
          setActiveRun((current) => (current?.token === token ? null : current));
          setFeedback({
            provider,
            phase: 'failed',
            total: 0,
            done: 0,
            currentConversationId: null,
            currentConversationTitle: '',
            currentStage: '',
            failures: [{ conversationId: 0, error: failureText }],
            warnings: [],
            message,
            updatedAt: Date.now(),
            summary: null,
          });
          throw error;
        }
      }

      const starter = (() => {
        switch (provider) {
          case 'notion':
            return syncNotionConversations;
          case 'feishu':
            return syncFeishuConversations;
          case 'github':
            return syncGithubConversations;
          default:
            return assertNever(provider);
        }
      })();

      const token = runTokenRef.current + 1;
      runTokenRef.current = token;
      const nextRun: ActiveRun = { provider, token };
      activeRunRef.current = nextRun;
      setActiveRun(nextRun);

      const runningFeedback: ConversationSyncFeedbackState = {
        provider,
        phase: 'running',
        total: ids.length,
        done: 0,
        currentConversationId: null,
        currentConversationTitle: '',
        currentStage: 'preparing_queue',
        failures: [],
        warnings: [],
        message: buildRunningMessage(provider, 0, ids.length),
        updatedAt: Date.now(),
        summary: null,
      };
      feedbackRef.current = runningFeedback;
      setFeedback(runningFeedback);

      try {
        const ack = await starter(ids);
        if (disposedRef.current) return ack;
        await refreshFromBackground(provider);
        return ack;
      } catch (error) {
        if (disposedRef.current) throw error;

        const code = errorCode(error);
        if (code === 'sync_already_running') {
          await refreshFromBackground(provider);
          return null;
        }

        const disabledByGate = code === 'sync_provider_disabled';
        const failureText = disabledByGate
          ? t('syncProviderDisabled')
          : error instanceof Error
            ? error.message
            : String(error || 'sync failed');
        const message = disabledByGate
          ? `${providerLabel(provider)} · ${t('phaseFailed')}: ${t('syncProviderDisabled')}`
          : toErrorMessage(provider, error);

        runTokenRef.current += 1;
        setActiveRun((current) => (current?.token === token ? null : current));
        setFeedback({
          provider,
          phase: 'failed',
          total: 0,
          done: 0,
          currentConversationId: null,
          currentConversationTitle: '',
          currentStage: '',
          failures: [{ conversationId: 0, error: failureText }],
          warnings: [],
          message,
          updatedAt: Date.now(),
          summary: null,
        });
        throw error;
      }
    },
    [
      refreshFromBackground,
      syncNotionConversations,
      syncObsidianConversations,
      syncFeishuConversations,
      syncGithubConversations,
    ],
  );

  return {
    feedback,
    clearFeedback,
    startSync,
    syncingNotion: feedback.phase === 'running' && feedback.provider === 'notion',
    syncingObsidian: feedback.phase === 'running' && feedback.provider === 'obsidian',
    syncingFeishu: feedback.phase === 'running' && feedback.provider === 'feishu',
    syncingGithub: feedback.phase === 'running' && feedback.provider === 'github',
  };
}
