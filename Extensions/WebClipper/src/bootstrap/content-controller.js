/* global console */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function createController({ runtime }) {
    const inpageButton = NS.inpageButton;
    const inpageTip = NS.inpageTip;

    function send(type, payload) {
      if (!runtime || typeof runtime.send !== "function") {
        return Promise.reject(new Error("runtime client unavailable"));
      }
      return runtime.send(type, payload);
    }

    function getCollector() {
      const reg = NS.collectorsRegistry;
      if (!reg || typeof reg.pickActive !== "function") return null;
      const picked = reg.pickActive();
      if (!picked || !picked.collector) return null;
      return { id: picked.id, ...picked.collector };
    }

    function getInpageCollector() {
      const reg = NS.collectorsRegistry;
      if (!reg) return null;
      const list = typeof reg.list === "function" ? reg.list() : [];
      if (!Array.isArray(list) || !list.length) return null;
      const loc = { href: location.href, hostname: location.hostname, pathname: location.pathname };
      for (const d of list) {
        if (!d) continue;
        const fn = typeof d.inpageMatches === "function" ? d.inpageMatches : d.matches;
        if (typeof fn !== "function") continue;
        try {
          if (fn(loc)) return { id: d.id, ...(d.collector || {}) };
        } catch (_e) {
          // ignore
        }
      }
      return null;
    }

    async function saveSnapshot(snapshot) {
      if (!snapshot || !snapshot.conversation) return;
      const convoRes = await send("upsertConversation", { payload: snapshot.conversation });
      if (!convoRes || !convoRes.ok) {
        throw new Error((convoRes && convoRes.error && convoRes.error.message) || "upsertConversation failed");
      }
      const convo = convoRes.data;
      const msgRes = await send("syncConversationMessages", {
        conversationId: convo.id,
        messages: snapshot.messages || []
      });
      if (!msgRes || !msgRes.ok) {
        throw new Error((msgRes && msgRes.error && msgRes.error.message) || "syncConversationMessages failed");
      }
      return { conversationId: convo.id };
    }

    function createAutoCaptureController() {
      let stopped = false;
      let observer = null;

      function stop() {
        if (stopped) return;
        stopped = true;
        inpageButton && inpageButton.cleanupButtons && inpageButton.cleanupButtons("");
        observer && observer.stop && observer.stop();
      }

      if (runtime && typeof runtime.onInvalidated === "function") {
        runtime.onInvalidated(() => stop());
      }

      // Manual button: trigger an immediate capture and save once.
      const clickSave = async () => {
        if (stopped) return;
        try {
          const collector = getCollector() || getInpageCollector();
          if (!collector || typeof collector.capture !== "function") return;
          const snapshot = collector.capture({ manual: true });
          if (!snapshot) {
            inpageTip && inpageTip.showSaveTip && inpageTip.showSaveTip("No visible conversation found");
            return;
          }
          await saveSnapshot(snapshot);
          inpageButton && inpageButton.flashInpageOk && inpageButton.flashInpageOk();
        } catch (_e) {
          inpageTip && inpageTip.showSaveTip && inpageTip.showSaveTip("Save failed");
        }
      };

      observer = NS.runtimeObserver && NS.runtimeObserver.createObserver({
        debounceMs: 600,
        getRoot: () => {
          if (stopped) return null;
          const c = getCollector();
          return c && typeof c.getRoot === "function" ? c.getRoot() : null;
        },
        onTick: async () => {
          if (stopped) return;
          try {
            const collector = getCollector();
            const inpageCollector = collector || getInpageCollector();
            inpageButton && inpageButton.cleanupButtons && inpageButton.cleanupButtons(inpageCollector && inpageCollector.id);
            inpageButton && inpageButton.ensureInpageButton && inpageButton.ensureInpageButton({
              collectorId: inpageCollector && inpageCollector.id,
              onClick: clickSave
            });
            if (!collector || typeof collector.capture !== "function") return;
            const snapshot = collector.capture();
            if (!snapshot) return;
            const inc = NS.incrementalUpdater && NS.incrementalUpdater.computeIncremental(snapshot);
            if (!inc || !inc.changed) return;
            await saveSnapshot(inc.snapshot);
            inpageButton && inpageButton.flashInpageOk && inpageButton.flashInpageOk();
          } catch (_e) {
            if (runtime && typeof runtime.isInvalidContextError === "function" && runtime.isInvalidContextError(_e)) {
              stop();
              return;
            }
            // Keep auto-save non-blocking, but leave a debug trail for DevTools.
            console.error("WebClipper auto-save failed:", _e);
          }
        }
      });

      return {
        start() {
          if (stopped) return;
          observer && observer.start && observer.start();
        },
        stop
      };
    }

    return {
      start() {
        const controller = createAutoCaptureController();
        controller.start();
        return controller;
      }
    };
  }

  NS.contentController = { createController };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.contentController;
})();

