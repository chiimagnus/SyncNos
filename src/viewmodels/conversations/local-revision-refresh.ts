import { getLocalDataFactsRevision } from '@services/local-data/client';
import type { FactsEpoch } from '@services/local-data/contracts';

export type LocalFactsRevisionCheck = Readonly<{
  factsRevision: number | null;
  refreshed: boolean;
  revisionChanged: boolean;
}>;

export type LocalFactsRevisionMonitor = Readonly<{
  checkForExternalChange: (refresh: () => Promise<void>) => Promise<LocalFactsRevisionCheck>;
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
  let inFlight: Promise<LocalFactsRevisionCheck> | null = null;
  let lastObservedRevision: number | null = null;

  const setFactsEpoch = (nextFactsEpoch: FactsEpoch | null) => {
    if (nextFactsEpoch === factsEpoch) return;
    factsEpoch = nextFactsEpoch;
    lastObservedRevision = null;
  };

  const runCheck = async (refresh: () => Promise<void>): Promise<LocalFactsRevisionCheck> => {
    if (!isNativeEpoch(factsEpoch)) return { factsRevision: null, refreshed: false, revisionChanged: false };
    const firstRevision = await getFactsRevision();
    if (firstRevision === null) return { factsRevision: null, refreshed: false, revisionChanged: false };
    if (lastObservedRevision === firstRevision) {
      return { factsRevision: firstRevision, refreshed: false, revisionChanged: false };
    }

    const hadBaseline = lastObservedRevision !== null;
    let revisionChanged = hadBaseline;
    let observedRevision = firstRevision;
    for (let attempt = 0; attempt < maxRefreshAttempts; attempt += 1) {
      await refresh();
      if (!isNativeEpoch(factsEpoch)) {
        return { factsRevision: null, refreshed: true, revisionChanged: true };
      }
      const afterRefresh = await getFactsRevision();
      if (afterRefresh === null) {
        return { factsRevision: null, refreshed: true, revisionChanged };
      }
      if (afterRefresh === observedRevision) {
        lastObservedRevision = afterRefresh;
        return { factsRevision: afterRefresh, refreshed: true, revisionChanged };
      }
      revisionChanged = true;
      observedRevision = afterRefresh;
    }

    // Another profile kept committing during our bounded refresh window. Keep the baseline unknown
    // so the next focus/visibility event rechecks instead of blessing a possibly stale snapshot.
    lastObservedRevision = null;
    return { factsRevision: null, refreshed: true, revisionChanged: true };
  };

  return Object.freeze({
    checkForExternalChange: async (refresh) => {
      if (typeof refresh !== 'function') throw new Error('refresh callback is required');
      if (!isNativeEpoch(factsEpoch)) return { factsRevision: null, refreshed: false, revisionChanged: false };
      if (inFlight) return await inFlight;
      inFlight = runCheck(refresh).finally(() => {
        inFlight = null;
      });
      return await inFlight;
    },
    setFactsEpoch,
  });
}
