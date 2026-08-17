import { CORE_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { send } from '@services/shared/runtime';
import { parseFactsEpoch, type FactsEpoch } from '@services/local-data/contracts';

type ApiError = Readonly<{ message: string; extra?: unknown }> | null;
type ApiResponse<T> = Readonly<{ ok: boolean; data: T | null; error: ApiError }>;

export type ConversationLocalDataRevisionSnapshot = Readonly<{
  factsEpoch: FactsEpoch;
  factsRevision: number | null;
}>;

export type LocalFactsRevisionCheck = Readonly<{
  factsEpoch: FactsEpoch | null;
  factsRevision: number | null;
  refreshed: boolean;
  revisionChanged: boolean;
}>;

export type LocalFactsRevisionMonitor = Readonly<{
  checkForExternalChange: (refresh: () => Promise<void>) => Promise<LocalFactsRevisionCheck>;
  setSnapshot: (snapshot: ConversationLocalDataRevisionSnapshot | null) => void;
}>;

export type LocalFactsRevisionMonitorDependencies = Readonly<{
  getSnapshot?: () => Promise<ConversationLocalDataRevisionSnapshot>;
  maxRefreshAttempts?: number;
}>;

function isNativeEpoch(value: FactsEpoch | null): boolean {
  return String(value || '').startsWith('native:');
}

function parseRevision(value: unknown, factsEpoch: FactsEpoch): number | null {
  if (value === null && factsEpoch === 'idb-v1') return null;
  if (value === null || !Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('invalid conversation local data revision');
  }
  return Number(value);
}

export function parseConversationLocalDataRevisionSnapshot(value: unknown): ConversationLocalDataRevisionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid conversation local data revision');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join('|') !== ['factsEpoch', 'factsRevision'].sort().join('|')) {
    throw new Error('invalid conversation local data revision');
  }
  const factsEpoch = parseFactsEpoch(input.factsEpoch);
  return Object.freeze({ factsEpoch, factsRevision: parseRevision(input.factsRevision, factsEpoch) });
}

function unwrap(response: ApiResponse<unknown>): unknown {
  if (response?.ok === true) return response.data;
  const error = response?.error;
  const result = new Error(error?.message || 'conversation local data revision read failed') as Error & {
    code?: string;
    diagnostics?: unknown;
  };
  const extra =
    error?.extra && typeof error.extra === 'object' && !Array.isArray(error.extra)
      ? (error.extra as Record<string, unknown>)
      : null;
  if (typeof extra?.code === 'string') result.code = extra.code;
  if (extra && Object.hasOwn(extra, 'diagnostics')) result.diagnostics = extra.diagnostics;
  throw result;
}

/** Tiny one-shot focus/visibility probe; no interval, alarm, or long-lived Port. */
export async function getConversationLocalDataRevision(): Promise<ConversationLocalDataRevisionSnapshot> {
  const response = await send<ApiResponse<unknown>>(CORE_MESSAGE_TYPES.GET_CONVERSATION_LOCAL_DATA_REVISION);
  return parseConversationLocalDataRevisionSnapshot(unwrap(response));
}

function sameSnapshot(
  left: ConversationLocalDataRevisionSnapshot,
  right: ConversationLocalDataRevisionSnapshot,
): boolean {
  return left.factsEpoch === right.factsEpoch && left.factsRevision === right.factsRevision;
}

export function createLocalFactsRevisionMonitor(
  dependencies: LocalFactsRevisionMonitorDependencies = {},
): LocalFactsRevisionMonitor {
  const getSnapshot = dependencies.getSnapshot ?? getConversationLocalDataRevision;
  const maxRefreshAttempts = dependencies.maxRefreshAttempts ?? 2;
  if (!Number.isSafeInteger(maxRefreshAttempts) || maxRefreshAttempts < 1 || maxRefreshAttempts > 4) {
    throw new Error('invalid local facts revision refresh bound');
  }

  let baseline: ConversationLocalDataRevisionSnapshot | null = null;
  let inFlight: Promise<LocalFactsRevisionCheck> | null = null;

  const setSnapshot = (snapshot: ConversationLocalDataRevisionSnapshot | null) => {
    baseline = snapshot ? parseConversationLocalDataRevisionSnapshot(snapshot) : null;
  };

  const runCheck = async (refresh: () => Promise<void>): Promise<LocalFactsRevisionCheck> => {
    if (!baseline || !isNativeEpoch(baseline.factsEpoch)) {
      return {
        factsEpoch: baseline?.factsEpoch ?? null,
        factsRevision: baseline?.factsRevision ?? null,
        refreshed: false,
        revisionChanged: false,
      };
    }

    let observed = await getSnapshot();
    if (sameSnapshot(baseline, observed)) {
      return {
        factsEpoch: observed.factsEpoch,
        factsRevision: observed.factsRevision,
        refreshed: false,
        revisionChanged: false,
      };
    }

    for (let attempt = 0; attempt < maxRefreshAttempts; attempt += 1) {
      await refresh();
      const afterRefresh = await getSnapshot();
      if (sameSnapshot(observed, afterRefresh)) {
        baseline = afterRefresh;
        return {
          factsEpoch: afterRefresh.factsEpoch,
          factsRevision: afterRefresh.factsRevision,
          refreshed: true,
          revisionChanged: true,
        };
      }
      observed = afterRefresh;
    }

    // Another profile kept committing while the bounded refresh loop was running. refresh() updates
    // baseline to the snapshot backing the most recently rendered list; keep that trusted baseline so
    // the next focus/visibility event can compare it again instead of disabling future probes.
    return {
      factsEpoch: baseline?.factsEpoch ?? null,
      factsRevision: baseline?.factsRevision ?? null,
      refreshed: true,
      revisionChanged: true,
    };
  };

  return Object.freeze({
    checkForExternalChange: async (refresh) => {
      if (typeof refresh !== 'function') throw new Error('refresh callback is required');
      if (!baseline || !isNativeEpoch(baseline.factsEpoch)) {
        return {
          factsEpoch: baseline?.factsEpoch ?? null,
          factsRevision: baseline?.factsRevision ?? null,
          refreshed: false,
          revisionChanged: false,
        };
      }
      if (inFlight) return await inFlight;
      inFlight = runCheck(refresh).finally(() => {
        inFlight = null;
      });
      return await inFlight;
    },
    setSnapshot,
  });
}
