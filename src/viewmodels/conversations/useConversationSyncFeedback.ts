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
import { normalizeSyncJobSnapshot, SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-store';
import { normalizeSyncConversationIds } from '@services/sync/sync-conversation-ids';
import { storageOnChanged } from '@services/shared/storage';
import type {
  SyncFailureSummary,
  SyncJobSnapshot,
  SyncJobStatusResponse,
  SyncPerConversationResult,
  SyncProvider,
  SyncRunSummary,
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

const SYNC_PROVIDER_SCAN_ORDER: readonly SyncProvider[] = ['notion', 'obsidian', 'feishu', 'github'];
const SYNC_PROVIDER_BY_STORAGE_KEY = new Map<string, SyncProvider>(
  SYNC_PROVIDER_SCAN_ORDER.map((provider) => [SYNC_JOB_STORAGE_KEYS[provider], provider]),
);

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

function toFailureSummariesFromRows(rows: readonly SyncPerConversationResult[]): SyncFailureSummary[] {
  return rows
    .filter((row) => !row.ok)
    .map((row) => ({
      conversationId: row.conversationId,
      conversationTitle: row.conversationTitle?.trim() ?? '',
      error: row.error || 'unknown error',
    }));
}

export type SyncWarningSummary = {
  conversationId: number;
  conversationTitle?: string;
  code: string;
  message: string;
  extra?: unknown;
};

function toWarningSummariesFromRows(rows: readonly SyncPerConversationResult[]): SyncWarningSummary[] {
  const out: SyncWarningSummary[] = [];
  for (const row of rows) {
    if (!row.warnings?.length) continue;
    for (const warning of row.warnings) {
      const conversationTitle = row.conversationTitle?.trim() ?? '';
      const code = warning.code.trim() || 'warning';
      const message = warning.message.trim() || code;
      out.push({ conversationId: row.conversationId, conversationTitle, code, message, extra: warning.extra });
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
  if (summary.failCount <= 0) return `${label} · ${t('phaseSuccess')} (${summary.okCount}/${total})`;
  if (summary.okCount > 0) return `${label} · ${t('phasePartialFailed')} (${summary.failCount}/${total})`;
  return `${label} · ${t('phaseFailed')} (${summary.failCount}/${total})`;
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
  const phase: ConversationSyncFeedbackPhase =
    summary.failCount <= 0 ? 'success' : summary.okCount > 0 ? 'partial-failed' : 'failed';

  return {
    provider: summary.provider,
    phase,
    total,
    done: total,
    currentConversationId: null,
    currentConversationTitle: '',
    currentStage: '',
    failures,
    warnings,
    message: buildFinishedMessage(summary, total),
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
  if (job.status === 'running') return null;
  return {
    provider: job.provider,
    okCount: job.okCount,
    failCount: job.failCount,
    failures: toFailureSummariesFromRows(job.perConversation),
    results: job.perConversation.slice(),
    jobId: job.id,
    instanceId: job.instanceId,
  };
}

function toFeedbackFromJob(job: SyncJobSnapshot): ConversationSyncFeedbackState {
  const completed = job.okCount + job.failCount;
  const total = job.totalCount;
  const failures = toFailureSummariesFromRows(job.perConversation);
  const warnings = toWarningSummariesFromRows(job.perConversation);

  if (job.status === 'running') {
    return {
      provider: job.provider,
      phase: 'running',
      total,
      done: Math.min(completed, total),
      currentConversationId: job.currentConversationId ?? null,
      currentConversationTitle: job.currentConversationTitle ?? '',
      currentStage: job.currentStage ?? '',
      failures,
      warnings,
      message: buildRunningMessage(job.provider, completed, total),
      updatedAt: job.updatedAt,
      summary: null,
    };
  }

  if (job.status === 'aborted') {
    return {
      provider: job.provider,
      phase: 'failed',
      total,
      done: Math.min(completed, total),
      currentConversationId: job.currentConversationId ?? null,
      currentConversationTitle: job.currentConversationTitle ?? '',
      currentStage: job.currentStage ?? '',
      failures,
      warnings,
      message: buildAbortedMessage(job),
      updatedAt: job.updatedAt,
      summary: toSummaryFromJob(job),
    };
  }

  return toTerminalFeedback(
    {
      provider: job.provider,
      okCount: job.okCount,
      failCount: job.failCount,
      failures,
      results: job.perConversation.slice(),
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
    .sort((a, b) => (b.job?.updatedAt ?? 0) - (a.job?.updatedAt ?? 0));
  if (activeWithRunningJob.length) return activeWithRunningJob[0]!;
  if (active.length) return active[0]!;

  const terminal = observations.filter(
    (observation) => !observation.active && observation.job && observation.job.status !== 'running',
  );
  if (preferredProvider) {
    const preferredTerminal = terminal.find((observation) => observation.provider === preferredProvider);
    if (preferredTerminal) return preferredTerminal;
  }
  terminal.sort((a, b) => (b.job?.updatedAt ?? 0) - (a.job?.updatedAt ?? 0));
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
  const handoffInFlightRef = useRef<symbol | null>(null);
  const activePollInFlightRef = useRef<Promise<void> | null>(null);

  const commitFeedback = useCallback((next: ConversationSyncFeedbackState) => {
    feedbackRef.current = next;
    setFeedback(next);
  }, []);

  const commitActiveRun = useCallback((next: ActiveRun | null) => {
    activeRunRef.current = next;
    setActiveRun(next);
  }, []);

  const ensureActiveRun = useCallback(
    (provider: SyncProvider): ActiveRun => {
      const current = activeRunRef.current;
      if (current?.provider === provider) return current;
      const token = runTokenRef.current + 1;
      runTokenRef.current = token;
      const next = { provider, token };
      commitActiveRun(next);
      return next;
    },
    [commitActiveRun],
  );

  const clearActiveRun = useCallback(() => {
    runTokenRef.current += 1;
    commitActiveRun(null);
  }, [commitActiveRun]);

  const advanceObservationGeneration = useCallback(() => {
    observationGenerationRef.current += 1;
    return observationGenerationRef.current;
  }, []);

  const getStatusGetter = useCallback(
    (provider: SyncProvider): (() => Promise<SyncJobStatusResponse>) => {
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
    },
    [getNotionSyncJobStatus, getObsidianSyncStatus, getFeishuSyncStatus, getGithubSyncStatus],
  );

  const readProviderStatus = useCallback(
    async (provider: SyncProvider): Promise<StatusReadOutcome> => {
      try {
        const status = await getStatusGetter(provider)();
        return {
          ok: true,
          observation: { provider, active: status.active === true, job: status.job ?? null },
        };
      } catch (_error) {
        return { ok: false, provider };
      }
    },
    [getStatusGetter],
  );

  const commitLiveObservation = useCallback(
    (observation: StatusObservation) => {
      ensureActiveRun(observation.provider);
      const current = feedbackRef.current;
      if (observation.job?.status === 'running') {
        commitFeedback(toFeedbackFromJob(observation.job));
        return;
      }
      if (current.phase === 'running' && current.provider === observation.provider) return;
      commitFeedback(toGenericRunningFeedback(observation.provider));
    },
    [commitFeedback, ensureActiveRun],
  );

  type FullScanOptions = {
    preferredProvider?: SyncProvider | null;
    terminalSeed?: SyncJobSnapshot | null;
    trustedInactiveProvider?: SyncProvider | null;
  };

  const runFullScan = useCallback(
    async (options: FullScanOptions = {}) => {
      const generation = advanceObservationGeneration();
      const outcomes = await Promise.all(SYNC_PROVIDER_SCAN_ORDER.map((provider) => readProviderStatus(provider)));
      if (disposedRef.current || observationGenerationRef.current !== generation) return null;

      const preferredProvider = options.preferredProvider ?? null;
      const preferredReadFailed =
        preferredProvider != null && outcomes.some((outcome) => !outcome.ok && outcome.provider === preferredProvider);
      const hasTrustedPreferredInactive =
        preferredProvider != null && options.trustedInactiveProvider === preferredProvider;
      if (
        preferredReadFailed &&
        !hasTrustedPreferredInactive &&
        activeRunRef.current?.provider === preferredProvider &&
        feedbackRef.current.phase === 'running'
      ) {
        return null;
      }

      const observations = outcomes
        .filter((outcome): outcome is Extract<StatusReadOutcome, { ok: true }> => outcome.ok)
        .map((outcome) => outcome.observation);

      const terminalSeed = options.terminalSeed;
      if (terminalSeed && terminalSeed.status !== 'running') {
        const seedProvider = terminalSeed.provider;
        const seedOutcome = outcomes.find(
          (outcome) => (outcome.ok ? outcome.observation.provider : outcome.provider) === seedProvider,
        );
        if (seedOutcome && !seedOutcome.ok) {
          if (options.trustedInactiveProvider === seedProvider) {
            observations.push({ provider: seedProvider, active: false, job: terminalSeed });
          } else {
            ensureActiveRun(seedProvider);
            const current = feedbackRef.current;
            if (!(current.phase === 'running' && current.provider === seedProvider)) {
              commitFeedback(toGenericRunningFeedback(seedProvider));
            }
            return null;
          }
        }
      }

      const selected = pickPrimaryObservation(observations, preferredProvider);
      if (selected?.active) {
        commitLiveObservation(selected);
        return selected.job;
      }

      if (selected?.job && selected.job.status !== 'running') {
        clearActiveRun();
        commitFeedback(toFeedbackFromJob(selected.job));
        return selected.job;
      }

      if (activeRunRef.current) clearActiveRun();
      if (feedbackRef.current.phase === 'failed' && feedbackRef.current.summary == null) return null;
      commitFeedback(IDLE_FEEDBACK);
      return null;
    },
    [
      advanceObservationGeneration,
      clearActiveRun,
      commitFeedback,
      commitLiveObservation,
      ensureActiveRun,
      readProviderStatus,
    ],
  );

  const startHandoff = useCallback(
    (options: FullScanOptions = {}) => {
      const identity = Symbol('sync-handoff');
      handoffInFlightRef.current = identity;
      const promise = runFullScan(options);
      void promise.finally(() => {
        if (handoffInFlightRef.current === identity) handoffInFlightRef.current = null;
      });
      return promise;
    },
    [runFullScan],
  );

  const convergeKnownProvider = useCallback(
    async (provider: SyncProvider) => {
      const generation = advanceObservationGeneration();
      const outcome = await readProviderStatus(provider);
      if (disposedRef.current || observationGenerationRef.current !== generation) return null;
      if (!outcome.ok) return null;

      const observation = outcome.observation;
      if (observation.active) {
        commitLiveObservation(observation);
        return observation.job;
      }

      if (observation.job && observation.job.status !== 'running') {
        return startHandoff({
          preferredProvider: provider,
          terminalSeed: observation.job,
          trustedInactiveProvider: provider,
        });
      }
      return startHandoff({ preferredProvider: provider, trustedInactiveProvider: provider });
    },
    [advanceObservationGeneration, commitLiveObservation, readProviderStatus, startHandoff],
  );

  useEffect(() => {
    disposedRef.current = false;
    void runFullScan();
    return () => {
      disposedRef.current = true;
      observationGenerationRef.current += 1;
      handoffInFlightRef.current = null;
      activePollInFlightRef.current = null;
    };
  }, [runFullScan]);

  useEffect(() => {
    return storageOnChanged((changes, areaName) => {
      if (areaName !== 'local' || !changes || typeof changes !== 'object') return;

      const changedByProvider = new Map<SyncProvider, SyncJobSnapshot | null>();
      for (const [key, change] of Object.entries(changes as Record<string, any>)) {
        const provider = SYNC_PROVIDER_BY_STORAGE_KEY.get(key) ?? null;
        if (!provider) continue;
        changedByProvider.set(provider, normalizeSyncJobSnapshot(provider, (change as any)?.newValue));
      }
      if (!changedByProvider.size) return;

      advanceObservationGeneration();
      // The durable event supersedes any older handoff read. Its promise may still settle,
      // but generation + identity checks prevent it from committing or clearing newer work.
      handoffInFlightRef.current = null;

      const changed = SYNC_PROVIDER_SCAN_ORDER.filter((provider) => changedByProvider.has(provider)).map(
        (provider) => ({ provider, job: changedByProvider.get(provider) ?? null }),
      );
      const current = feedbackRef.current;

      if (current.phase === 'running' && current.provider) {
        const ownChange = changed.find((item) => item.provider === current.provider);
        if (!ownChange) return;
        if (ownChange.job?.status === 'running') {
          ensureActiveRun(current.provider);
          commitFeedback(toFeedbackFromJob(ownChange.job));
          return;
        }
        if (ownChange.job) {
          void startHandoff({ preferredProvider: current.provider, terminalSeed: ownChange.job });
          return;
        }
        void startHandoff({ preferredProvider: current.provider });
        return;
      }

      const runningChange = changed.find((item) => item.job?.status === 'running');
      if (runningChange?.job) {
        ensureActiveRun(runningChange.provider);
        commitFeedback(toFeedbackFromJob(runningChange.job));
        return;
      }

      if (current.summary != null && current.provider) {
        const ownChange = changed.find((item) => item.provider === current.provider);
        if (!ownChange) return;
        if (ownChange.job && ownChange.job.status !== 'running') {
          void startHandoff({ preferredProvider: current.provider, terminalSeed: ownChange.job });
          return;
        }
        if (!ownChange.job) void startHandoff({ preferredProvider: current.provider });
        return;
      }

      const terminalChanges = changed
        .filter((item) => item.job && item.job.status !== 'running')
        .sort((left, right) => (right.job?.updatedAt ?? 0) - (left.job?.updatedAt ?? 0));
      const terminal = terminalChanges[0];
      if (terminal?.job) {
        void startHandoff({ preferredProvider: terminal.provider, terminalSeed: terminal.job });
        return;
      }

      if (
        current.provider &&
        changedByProvider.has(current.provider) &&
        changedByProvider.get(current.provider) == null
      ) {
        void startHandoff({ preferredProvider: current.provider });
      }
    });
  }, [advanceObservationGeneration, commitFeedback, ensureActiveRun, startHandoff]);

  useEffect(() => {
    if (!activeRun) return;
    const token = activeRun.token;
    const provider = activeRun.provider;
    let disposed = false;

    const launchPoll = () => {
      if (disposed || disposedRef.current || handoffInFlightRef.current || activePollInFlightRef.current) return;
      const generation = advanceObservationGeneration();
      const promise = (async () => {
        const outcome = await readProviderStatus(provider);
        if (
          disposed ||
          disposedRef.current ||
          runTokenRef.current !== token ||
          observationGenerationRef.current !== generation
        ) {
          return;
        }
        if (!outcome.ok) return;

        const observation = outcome.observation;
        if (observation.active) {
          if (observation.job?.status === 'running') commitFeedback(toFeedbackFromJob(observation.job));
          return;
        }

        if (observation.job && observation.job.status !== 'running') {
          await startHandoff({
            preferredProvider: provider,
            terminalSeed: observation.job,
            trustedInactiveProvider: provider,
          });
          return;
        }
        await startHandoff({ preferredProvider: provider, trustedInactiveProvider: provider });
      })();
      activePollInFlightRef.current = promise;
      void promise.finally(() => {
        if (activePollInFlightRef.current === promise) activePollInFlightRef.current = null;
      });
    };

    const timer = window.setInterval(launchPoll, 500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      if (runTokenRef.current !== token) activePollInFlightRef.current = null;
    };
  }, [activeRun, advanceObservationGeneration, commitFeedback, readProviderStatus, startHandoff]);

  const clearFeedback = useCallback(() => {
    const current = feedbackRef.current;
    if (current.phase === 'running') return;
    advanceObservationGeneration();
    handoffInFlightRef.current = null;
    activePollInFlightRef.current = null;
    if (!current.provider) {
      commitFeedback(IDLE_FEEDBACK);
      return;
    }

    commitFeedback(IDLE_FEEDBACK);
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
      .then(() => startHandoff({ preferredProvider: current.provider }));
  }, [
    advanceObservationGeneration,
    clearNotionSyncJobStatus,
    clearObsidianSyncStatus,
    clearFeishuSyncStatus,
    clearGithubSyncStatus,
    commitFeedback,
    startHandoff,
  ]);

  const startSync = useCallback(
    async (provider: SyncProvider, conversationIds: number[]): Promise<SyncStartAck | null> => {
      const ids = normalizeSyncConversationIds(conversationIds);
      if (!ids.length) return null;

      const starter = (() => {
        switch (provider) {
          case 'notion':
            return syncNotionConversations;
          case 'obsidian':
            return syncObsidianConversations;
          case 'feishu':
            return syncFeishuConversations;
          case 'github':
            return syncGithubConversations;
          default:
            return assertNever(provider);
        }
      })();

      advanceObservationGeneration();
      handoffInFlightRef.current = null;
      activePollInFlightRef.current = null;
      const token = runTokenRef.current + 1;
      runTokenRef.current = token;
      const nextRun: ActiveRun = { provider, token };
      commitActiveRun(nextRun);

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
      commitFeedback(runningFeedback);

      try {
        const ack = await starter(ids);
        if (disposedRef.current) return ack;
        await convergeKnownProvider(provider);
        return ack;
      } catch (error) {
        if (disposedRef.current) throw error;

        const code = errorCode(error);
        if (code === 'sync_already_running') {
          await convergeKnownProvider(provider);
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

        advanceObservationGeneration();
        handoffInFlightRef.current = null;
        activePollInFlightRef.current = null;
        if (activeRunRef.current?.token === token) clearActiveRun();
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
        commitFeedback(failedFeedback);
        throw error;
      }
    },
    [
      advanceObservationGeneration,
      clearActiveRun,
      commitActiveRun,
      commitFeedback,
      convergeKnownProvider,
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
