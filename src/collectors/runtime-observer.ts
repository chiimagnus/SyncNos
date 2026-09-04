type ObserverInput = {
  debounceMs: number;
  onTick: () => void | Promise<void>;
  getRoot: () => Node | null;
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
  const { debounceMs, getRoot, onTick } = input;
  const debouncedTick = debounce(() => void onTick(), debounceMs);

  let observer: MutationObserver | null = null;
  let observedRoot: Node | null = null;
  let rootRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let started = false;

  function readRequestedRoot(): Node | null {
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
      void onTick();

      rootRefreshTimer = setInterval(() => {
        if (!started) return;
        const nextRoot = readRequestedRoot();
        if (nextRoot && nextRoot !== observedRoot) {
          ensureObservedRoot(nextRoot);
          void onTick();
        }
      }, 800);
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
