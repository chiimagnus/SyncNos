type ObserverInput = {
  debounceMs?: number;
  onTick?: () => void;
  getRoot?: () => Node | null;
  leading?: boolean;
};

type ObserverController = {
  start: () => void;
  stop: () => void;
};

function debounce(callback: () => void, wait: number): { trigger: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        callback();
      }, wait);
    },
    cancel() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}

export function createObserver(input: ObserverInput): ObserverController {
  const onTick = typeof input?.onTick === 'function' ? input.onTick : null;
  const debounceMs = typeof input?.debounceMs === 'number' ? input.debounceMs : 500;
  const debouncedTick = debounce(() => onTick?.(), debounceMs);
  const getRoot = typeof input?.getRoot === 'function' ? input.getRoot : null;
  const leading = input?.leading !== false;

  let observer: MutationObserver | null = null;
  let observedRoot: Node | null = null;
  let rootRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let started = false;

  function getDefaultRoot(): Node | null {
    return document.documentElement || document.body || null;
  }

  function readRequestedRoot(): Node | null {
    if (!getRoot) return getDefaultRoot();
    try {
      return getRoot();
    } catch (_error) {
      return null;
    }
  }

  function ensureObservedRoot(nextRoot: Node | null) {
    if (!nextRoot) return;
    if (observedRoot === nextRoot && observer) return;

    if (observer) observer.disconnect();
    observedRoot = nextRoot;
    observer = new MutationObserver(() => debouncedTick.trigger());
    observer.observe(observedRoot, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }

  return {
    start() {
      if (started) return;
      started = true;

      ensureObservedRoot(readRequestedRoot());
      if (leading) onTick?.();
      else debouncedTick.trigger();

      if (getRoot && !rootRefreshTimer) {
        rootRefreshTimer = setInterval(() => {
          if (!started) return;
          const nextRoot = readRequestedRoot();
          if (nextRoot && nextRoot !== observedRoot) {
            ensureObservedRoot(nextRoot);
            onTick?.();
          }
        }, 800);
      }
    },
    stop() {
      started = false;
      debouncedTick.cancel();
      if (rootRefreshTimer) {
        clearInterval(rootRefreshTimer);
        rootRefreshTimer = null;
      }
      observer?.disconnect();
      observer = null;
      observedRoot = null;
    },
  };
}
