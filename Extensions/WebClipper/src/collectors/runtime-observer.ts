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

function debounce(callback: () => void, wait: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => callback(), wait);
  };
}

export function createObserver(input: ObserverInput): ObserverController {
  const onTick = typeof input?.onTick === 'function' ? input.onTick : null;
  const debounceMs = typeof input?.debounceMs === 'number' ? input.debounceMs : 500;
  const tick = debounce(() => onTick?.(), debounceMs);
  const getRoot = typeof input?.getRoot === 'function' ? input.getRoot : null;
  const leading = input?.leading !== false;

  let observer: MutationObserver | null = null;
  let observedRoot: Node | null = null;
  let rootRefreshTimer: ReturnType<typeof setInterval> | null = null;

  function getDefaultRoot(): Node | null {
    return document.documentElement || document.body || null;
  }

  function ensureObservedRoot(root?: Node | null) {
    const nextRoot = root || getDefaultRoot();
    if (!nextRoot) return;
    if (observedRoot === nextRoot && observer) return;

    if (observer) observer.disconnect();
    observedRoot = nextRoot;
    observer = new MutationObserver(() => tick());
    observer.observe(observedRoot, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }

  return {
    start() {
      if (observer) return;

      ensureObservedRoot(getRoot ? getRoot() : getDefaultRoot());
      if (leading) {
        onTick?.();
      } else {
        tick();
      }

      if (getRoot && !rootRefreshTimer) {
        rootRefreshTimer = setInterval(() => {
          if (!observer) return;
          let nextRoot: Node | null = null;
          try {
            nextRoot = getRoot();
          } catch (_error) {
            nextRoot = null;
          }
          if (nextRoot && nextRoot !== observedRoot) {
            ensureObservedRoot(nextRoot);
            onTick?.();
          }
        }, 800);
      }
    },
    stop() {
      if (!observer) return;
      observer.disconnect();
      observer = null;
      observedRoot = null;
      if (rootRefreshTimer) {
        clearInterval(rootRefreshTimer);
        rootRefreshTimer = null;
      }
    },
  };
}

const runtimeObserverApi = { createObserver };
export default runtimeObserverApi;
