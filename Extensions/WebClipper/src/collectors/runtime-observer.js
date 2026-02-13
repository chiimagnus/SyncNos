(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function debounce(fn, wait) {
    let t = null;
    return function (...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function createObserver({ debounceMs, onTick, getRoot, leading }) {
    const tick = debounce(() => onTick && onTick(), typeof debounceMs === "number" ? debounceMs : 500);
    let mo = null;
    let observedRoot = null;
    let rootRefreshTimer = null;

    function getDefaultRoot() {
      return document.documentElement || document.body;
    }

    function ensureObservedRoot(root) {
      const nextRoot = root || getDefaultRoot();
      if (observedRoot === nextRoot && mo) return;

      if (mo) mo.disconnect();
      observedRoot = nextRoot;
      mo = new MutationObserver(() => tick());
      mo.observe(observedRoot, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });
    }

    return {
      start() {
        if (mo) return;
        // Allow callers to narrow observation to a platform-specific root.
        // If getRoot isn't provided, we observe the whole document.
        const hasCustomRoot = typeof getRoot === "function";
        ensureObservedRoot(hasCustomRoot ? getRoot() : getDefaultRoot());
        if (leading !== false) {
          onTick && onTick();
        } else {
          tick();
        }

        // SPAs (e.g. NotionAI) often replace the chat root without triggering mutations
        // on the previously observed node. Periodically re-pick the root to avoid
        // "stuck" observers and delayed UI (inpage button) updates.
        if (hasCustomRoot && !rootRefreshTimer) {
          rootRefreshTimer = setInterval(() => {
            if (!mo) return;
            let next = null;
            try {
              next = getRoot();
            } catch (_e) {
              next = null;
            }
            if (next && next !== observedRoot) {
              ensureObservedRoot(next);
              // Root changed: run an immediate tick so UI appears quickly.
              onTick && onTick();
            }
          }, 800);
        }
      },
      stop() {
        if (!mo) return;
        mo.disconnect();
        mo = null;
        observedRoot = null;
        if (rootRefreshTimer) {
          clearInterval(rootRefreshTimer);
          rootRefreshTimer = null;
        }
      }
    };
  }

  NS.runtimeObserver = { createObserver };
})();
