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

type StatusObservation = {
  provider: SyncProvider;
  active: boolean;
  job: SyncJobSnapshot | null;
};

type StatusReadOutcome = { ok: true; observation: StatusObservation } | { ok: false; provider: SyncProvider };

function toGenericRunningFeedback(provider: SyncProvider): ConversationSyncFeedbackState {
  return {
    provider,
    phase: 'running',
    total: 0,
    done: 0,
    currentConversationId: null,
    currentConversationTitle: '',
    currentStage: '',
    failures: [],
    warnings: [],
    message: buildRunningMessage(provider, 0, 0),
    updatedAt: Date.now(),
    summary: null,
  };
}

function pickPrimaryObservation(
  observations: StatusObservation[],
  preferredProvider?: SyncProvider | null,
): StatusObservation | null {
  const active = observations.filter((observation) => observation.active);
  if (preferredProvider) {
    const preferredActive = active.find((observation) => observation.provider === preferredProvider);
    if (preferredActive) return preferredActive;
  }
  const activeWithRunningJob = active
    .filter((observation) => observation.job?.status === 'running')
    .sort((a, b) => (Number(b.job?.updatedAt) || 0) - (Number(a.job?.updatedAt) || 0));
  if (activeWithRunningJob.length) return activeWithRunningJob[0]!;
  if (active.length) return active[0]!;

  const terminal = observations.filter(
    (observation) => !observation.active && observation.job && observation.job.status !== 'running',
  );
  if (preferredProvider) {
    const preferredTerminal = terminal.find((observation) => observation.provider === preferredProvider);
    if (preferredTerminal) return preferredTerminal;
  }
  terminal.sort((a, b) => (Number(b.job?.updatedAt) || 0) - (Number(a.job?.updatedAt) || 0));
  return terminal[0] ?? null;
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
  const observationGenerationRef = useRef(0);
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
      const generation = observationGenerationRef.current;
      const read = async (
        provider: SyncProvider,
        getter: () => Promise<SyncJobStatusResponse>,
      ): Promise<StatusReadOutcome> => {
        try {
          const status = await getter();
          return {
            ok: true,
            observation: { provider, active: status.active === true, job: status.job ?? null },
          };
        } catch (_error) {
          return { ok: false, provider };
        }
      };
      const outcomes = await Promise.all([
        read('notion', getNotionSyncJobStatus),
        read('obsidian', getObsidianSyncStatus),
        read('feishu', getFeishuSyncStatus),
        read('github', getGithubSyncStatus),
      ]);
      if (disposedRef.current || observationGenerationRef.current !== generation) return null;

      const preferredReadFailed =
        preferredProvider != null && outcomes.some((outcome) => !outcome.ok && outcome.provider === preferredProvider);
      if (
        preferredReadFailed &&
        activeRunRef.current?.provider === preferredProvider &&
        feedbackRef.current.phase === 'running'
      ) {
        return null;
      }

      const observations = outcomes
        .filter((outcome): outcome is Extract<StatusReadOutcome, { ok: true }> => outcome.ok)
        .map((outcome) => outcome.observation);
      const selected = pickPrimaryObservation(observations, preferredProvider);

      if (selected?.active) {
        let nextRun = activeRunRef.current;
        if (nextRun?.provider !== selected.provider) {
          const token = runTokenRef.current + 1;
          runTokenRef.current = token;
          nextRun = { provider: selected.provider, token };
          activeRunRef.current = nextRun;
          setActiveRun(nextRun);
        }
        const current = feedbackRef.current;
        const nextFeedback =
          selected.job?.status === 'running'
            ? toFeedbackFromJob(selected.job)
            : current.phase === 'running' && current.provider === selected.provider
              ? current
              : toGenericRunningFeedback(selected.provider);
        feedbackRef.current = nextFeedback;
        setFeedback(nextFeedback);
        return selected.job;
      }

      if (selected?.job && selected.job.status !== 'running') {
        runTokenRef.current += 1;
        activeRunRef.current = null;
        setActiveRun(null);
        const nextFeedback = toFeedbackFromJob(selected.job);
        feedbackRef.current = nextFeedback;
        setFeedback(nextFeedback);
        return selected.job;
      }

      if (activeRunRef.current && feedbackRef.current.phase === 'running') {
        runTokenRef.current += 1;
        activeRunRef.current = null;
        setActiveRun(null);
      }
      if (feedbackRef.current.phase === 'failed' && feedbackRef.current.summary == null) return null;
      feedbackRef.current = IDLE_FEEDBACK;
      setFeedback(IDLE_FEEDBACK);
      return null;
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
        if (status.active === true) {
          if (status.job?.status === 'running') {
            const nextFeedback = toFeedbackFromJob(status.job);
            feedbackRef.current = nextFeedback;
            setFeedback(nextFeedback);
          }
          return;
        }
        await refreshFromBackground(provider);
      } catch (_error) {
        // A failed status read is not equivalent to active=false; keep the current run and retry.
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
    observationGenerationRef.current += 1;
    if (!current.provider) {
      feedbackRef.current = IDLE_FEEDBACK;
      setFeedback(IDLE_FEEDBACK);
      return;
    }

    feedbackRef.current = IDLE_FEEDBACK;
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
      observationGenerationRef.current += 1;

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

          observationGenerationRef.current += 1;
          runTokenRef.current += 1;
          activeRunRef.current = null;
          setActiveRun((current) => (current?.token === token ? null : current));
          const failedFeedback: ConversationSyncFeedbackState = {
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
          };
          feedbackRef.current = failedFeedback;
          setFeedback(failedFeedback);
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

        observationGenerationRef.current += 1;
        runTokenRef.current += 1;
        activeRunRef.current = null;
        setActiveRun((current) => (current?.token === token ? null : current));
        const failedFeedback: ConversationSyncFeedbackState = {
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
        };
        feedbackRef.current = failedFeedback;
        setFeedback(failedFeedback);
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
