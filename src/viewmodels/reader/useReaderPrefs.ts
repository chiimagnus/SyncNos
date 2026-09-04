import { useCallback, useEffect, useRef, useState } from 'react';
import {
  READER_PREFS_STORAGE_KEY,
  buildReaderPrefsStoragePatch,
  normalizeReaderPrefs,
  resolveReaderPrefsFromStorage,
  type ReaderPrefs,
  type ReaderPrefsPatch,
} from '@services/protocols/reader-prefs';
import { storageGet, storageOnChanged, storageSet } from '@services/shared/storage';

export type UseReaderPrefsResult = {
  prefs: ReaderPrefs;
  update: (patch: ReaderPrefsPatch) => Promise<void>;
  preview: (patch: ReaderPrefsPatch) => void;
  commitPreview: () => Promise<void>;
};

function mergePatch(left: ReaderPrefsPatch, right: ReaderPrefsPatch): ReaderPrefsPatch {
  return {
    ...left,
    ...right,
    ...(left.tts || right.tts ? { tts: { ...(left.tts ?? {}), ...(right.tts ?? {}) } } : {}),
  };
}

function applyPatch(base: ReaderPrefs, patch: ReaderPrefsPatch): ReaderPrefs {
  return normalizeReaderPrefs({
    ...base,
    ...patch,
    tts: { ...base.tts, ...(patch.tts ?? {}) },
  });
}

function hasPatch(patch: ReaderPrefsPatch): boolean {
  return Object.keys(patch).length > 0;
}

function prefsEqual(left: ReaderPrefs, right: ReaderPrefs): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function useReaderPrefs(): UseReaderPrefsResult {
  const initial = resolveReaderPrefsFromStorage(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(initial);
  const durablePrefsRef = useRef<ReaderPrefs>(initial);
  const dirtyPatchRef = useRef<ReaderPrefsPatch>({});
  const previewGenerationRef = useRef(0);
  const durableObservationGenerationRef = useRef(0);
  const disposedRef = useRef(false);
  const writerPromiseRef = useRef<Promise<void> | null>(null);
  const hydrationErrorRef = useRef<unknown>(null);
  const hydrationSettledRef = useRef(false);
  const hydrationReadyResolveRef = useRef<() => void>(() => {});
  const hydrationReadyPromiseRef = useRef<Promise<void> | null>(null);
  if (!hydrationReadyPromiseRef.current) {
    hydrationReadyPromiseRef.current = new Promise<void>((resolve) => {
      hydrationReadyResolveRef.current = resolve;
    });
  }

  const publishDisplay = useCallback((next: ReaderPrefs) => {
    if (!disposedRef.current) setPrefs(next);
  }, []);

  const publishMergedDisplay = useCallback(() => {
    publishDisplay(applyPatch(durablePrefsRef.current, dirtyPatchRef.current));
  }, [publishDisplay]);

  const applyDurableObservation = useCallback(
    (next: ReaderPrefs) => {
      durablePrefsRef.current = normalizeReaderPrefs(next);
      durableObservationGenerationRef.current += 1;
      publishMergedDisplay();
    },
    [publishMergedDisplay],
  );

  const markHydrationReady = useCallback(() => {
    if (hydrationSettledRef.current) return;
    hydrationSettledRef.current = true;
    hydrationReadyResolveRef.current();
  }, []);

  const runWriter = useCallback(async () => {
    const generationBeforeHydration = previewGenerationRef.current;
    await hydrationReadyPromiseRef.current;
    if (hydrationErrorRef.current) {
      const error = hydrationErrorRef.current;
      if (previewGenerationRef.current === generationBeforeHydration) {
        dirtyPatchRef.current = {};
        publishDisplay(durablePrefsRef.current);
      } else {
        publishMergedDisplay();
      }
      throw error;
    }

    while (hasPatch(dirtyPatchRef.current)) {
      const generationAtStart = previewGenerationRef.current;
      const next = applyPatch(durablePrefsRef.current, dirtyPatchRef.current);

      if (prefsEqual(next, durablePrefsRef.current)) {
        if (previewGenerationRef.current === generationAtStart) {
          dirtyPatchRef.current = {};
          publishDisplay(durablePrefsRef.current);
        }
        continue;
      }

      const observationAtStart = durableObservationGenerationRef.current;
      try {
        await storageSet(buildReaderPrefsStoragePatch(next));
      } catch (error) {
        if (previewGenerationRef.current === generationAtStart) {
          dirtyPatchRef.current = {};
          publishDisplay(durablePrefsRef.current);
          throw error;
        }
        continue;
      }

      const observationChanged = durableObservationGenerationRef.current !== observationAtStart;
      const observedMatchesWrite = prefsEqual(durablePrefsRef.current, next);
      if (!observationChanged) {
        applyDurableObservation(next);
      }

      if (previewGenerationRef.current === generationAtStart && (!observationChanged || observedMatchesWrite)) {
        dirtyPatchRef.current = {};
        publishDisplay(durablePrefsRef.current);
        continue;
      }

      // A newer preview or external durable observation won the race. Keep the local
      // dirty intent and let the next loop rebase it onto the latest durable snapshot.
      publishMergedDisplay();
    }
  }, [applyDurableObservation, publishDisplay, publishMergedDisplay]);

  const requestCommit = useCallback((): Promise<void> => {
    if (!hasPatch(dirtyPatchRef.current)) return Promise.resolve();
    if (writerPromiseRef.current) return writerPromiseRef.current;

    let tracked!: Promise<void>;
    tracked = runWriter().finally(() => {
      if (writerPromiseRef.current === tracked) writerPromiseRef.current = null;
    });
    writerPromiseRef.current = tracked;
    return tracked;
  }, [runWriter]);

  const preview = useCallback(
    (patch: ReaderPrefsPatch) => {
      dirtyPatchRef.current = mergePatch(dirtyPatchRef.current, patch);
      previewGenerationRef.current += 1;
      publishMergedDisplay();
    },
    [publishMergedDisplay],
  );

  const update = useCallback(
    (patch: ReaderPrefsPatch) => {
      preview(patch);
      return requestCommit();
    },
    [preview, requestCommit],
  );

  useEffect(() => {
    disposedRef.current = false;
    const hydrateGeneration = durableObservationGenerationRef.current;
    const unsubscribe = storageOnChanged((changes, areaName) => {
      if (disposedRef.current || (areaName && areaName !== 'local')) return;
      const change = changes?.[READER_PREFS_STORAGE_KEY];
      if (!change) return;
      hydrationErrorRef.current = null;
      applyDurableObservation(normalizeReaderPrefs((change as { newValue?: unknown }).newValue ?? null));
      markHydrationReady();
    });

    void (async () => {
      try {
        const stored = await storageGet([READER_PREFS_STORAGE_KEY]);
        if (durableObservationGenerationRef.current !== hydrateGeneration) return;
        hydrationErrorRef.current = null;
        // A successful initial read remains authoritative even after unmount. Updating
        // refs here lets the best-effort final commit rebase onto the real durable base;
        // publishDisplay already suppresses setState once disposed.
        applyDurableObservation(resolveReaderPrefsFromStorage(stored));
        markHydrationReady();
      } catch (error) {
        if (durableObservationGenerationRef.current !== hydrateGeneration) return;
        hydrationErrorRef.current = error;
        if (!disposedRef.current) {
          console.warn('[reader] failed to load reader prefs', {
            error: error instanceof Error ? error.message : String(error || ''),
          });
        }
        // Wake a waiting writer so it can fail closed instead of writing defaults. A
        // later storage observation clears this error and restores commit capability.
        markHydrationReady();
      }
    })();

    return () => {
      disposedRef.current = true;
      unsubscribe();
      if (hasPatch(dirtyPatchRef.current) && !writerPromiseRef.current) {
        void requestCommit().catch(() => {});
      }
    };
  }, [applyDurableObservation, markHydrationReady, requestCommit]);

  return { prefs, update, preview, commitPreview: requestCommit };
}
