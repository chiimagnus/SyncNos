import { getLocalDataFactsRevision } from '@services/local-data/client';
import type { FactsEpoch } from '@services/local-data/contracts';

export type LocalFactsRevisionMonitor = Readonly<{
  checkForExternalChange: (refresh: () => Promise<void>) => Promise<boolean>;
  setFactsEpoch: (factsEpoch: FactsEpoch | null) => void;
}>;

export type LocalFactsRevisionMonitorDependencies = Readonly<{
  getFactsRevision?: () => Promise<number | null>;
  maxRefreshAttempts?: number;
}>;

function isNativeEpoch(value: FactsEpoch | null): boolean {
  return String(value || '').startsWith('native:');
}

export function createLocalFactsRevisionMonitor(
  dependencies: LocalFactsRevisionMonitorDependencies = {},
): LocalFactsRevisionMonitor {
  const getFactsRevision = dependencies.getFactsRevision ?? getLocalDataFactsRevision;
  const maxRefreshAttempts = dependencies.maxRefreshAttempts ?? 2;
  if (!Number.isSafeInteger(maxRefreshAttempts) || maxRefreshAttempts < 1 || maxRefreshAttempts > 4) {
    throw new Error('invalid local facts revision refresh bound');
  }

  let factsEpoch: FactsEpoch | null = null;
  let inFlight: Promise<boolean> | null = null;
  let lastObservedRevision: number | null = null;

  const setFactsEpoch = (nextFactsEpoch: FactsEpoch | null) => {
    if (nextFactsEpoch === factsEpoch) return;
    factsEpoch = nextFactsEpoch;
    lastObservedRevision = null;
  };

  const runCheck = async (refresh: () => Promise<void>): Promise<boolean> => {
    if (!isNativeEpoch(factsEpoch)) return false;
    const firstRevision = await getFactsRevision();
    if (firstRevision === null) return false;
    if (lastObservedRevision === firstRevision) return false;

    let observedRevision = firstRevision;
    for (let attempt = 0; attempt < maxRefreshAttempts; attempt += 1) {
      await refresh();
      if (!isNativeEpoch(factsEpoch)) return true;
      const afterRefresh = await getFactsRevision();
      if (afterRefresh === null) return true;
      if (afterRefresh === observedRevision) {
        lastObservedRevision = afterRefresh;
        return true;
      }
      observedRevision = afterRefresh;
    }

    // Another profile kept committing during our bounded refresh window. Keep the baseline unknown
    // so the next focus/visibility event rechecks instead of blessing a possibly stale snapshot.
    lastObservedRevision = null;
    return true;
  };

  return Object.freeze({
    checkForExternalChange: async (refresh) => {
      if (typeof refresh !== 'function') throw new Error('refresh callback is required');
      if (!isNativeEpoch(factsEpoch)) return false;
      if (inFlight) return await inFlight;
      inFlight = runCheck(refresh).finally(() => {
        inFlight = null;
      });
      return await inFlight;
    },
    setFactsEpoch,
  });
}
