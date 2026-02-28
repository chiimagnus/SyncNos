/* global console, chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const contracts = NS.messageContracts || {};
  const CORE_MESSAGE_TYPES = contracts.CORE_MESSAGE_TYPES || Object.freeze({
    UPSERT_CONVERSATION: "upsertConversation",
    SYNC_CONVERSATION_MESSAGES: "syncConversationMessages"
  });
  const ARTICLE_MESSAGE_TYPES = contracts.ARTICLE_MESSAGE_TYPES || Object.freeze({
    FETCH_ACTIVE_TAB: "fetchActiveTabArticle"
  });
  const UI_MESSAGE_TYPES = contracts.UI_MESSAGE_TYPES || Object.freeze({
    OPEN_EXTENSION_POPUP: "openExtensionPopup"
  });

  const EASTER_EGG_LINES = Object.freeze({
    3: ["Combo x3! Nice rhythm.", "Three taps. Paw approved."],
    5: ["Combo x5! Beast mode on.", "Five-hit streak. Zoomies unlocked."],
    7: ["Combo x7! Legendary paws.", "Seven-hit streak. Animal boss mood."]
  });
  const INPAGE_SUPPORTED_ONLY_STORAGE_KEY = "inpage_supported_only";

  function createController({ runtime }) {
    const inpageButton = NS.inpageButton;
    const inpageTip = NS.inpageTip;
    let inpageSupportedOnly = false;

    function showInpageTip(text, kind) {
      if (!inpageTip || typeof inpageTip.showSaveTip !== "function") return;
      inpageTip.showSaveTip(text, { kind });
    }

    function errorMessage(err, fallback) {
      const msg = err && typeof err === "object" && "message" in err ? err.message : err;
      const text = String(msg || fallback || "Save failed").trim();
      return text || String(fallback || "Save failed");
    }

    async function runManualSaveFlow({ startText, run }) {
      showInpageTip(startText || "Saving...", "loading");
      try {
        const value = await run();
        showInpageTip("Saved", "ok");
        return value;
      } catch (e) {
        showInpageTip(errorMessage(e, "Save failed"), "error");
        throw e;
      }
    }

    function send(type, payload) {
      if (!runtime || typeof runtime.send !== "function") {
        return Promise.reject(new Error("runtime client unavailable"));
      }
      return runtime.send(type, payload);
    }

    function pickLineByLevel(level) {
      const lines = EASTER_EGG_LINES[level];
      if (!Array.isArray(lines) || !lines.length) return "";
      const idx = Math.floor(Math.random() * lines.length);
      return lines[idx] || lines[0];
    }

    function normalizeInpageSupportedOnly(value) {
      return value === true;
    }

    function shouldAllowInpageCollector(collectorId) {
      if (collectorId !== "web") return true;
      return !inpageSupportedOnly;
    }

    function readInpageSupportedOnlySetting() {
      return new Promise((resolve) => {
        try {
          if (!chrome || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.get !== "function") {
            return resolve(false);
          }
          chrome.storage.local.get([INPAGE_SUPPORTED_ONLY_STORAGE_KEY], (res) => {
            resolve(normalizeInpageSupportedOnly(res && res[INPAGE_SUPPORTED_ONLY_STORAGE_KEY]));
          });
        } catch (_e) {
          resolve(false);
        }
      });
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
          if (fn(loc) && shouldAllowInpageCollector(d.id)) return { id: d.id, ...(d.collector || {}) };
        } catch (_e) {
          // ignore
        }
      }
      return null;
    }

    async function saveSnapshot(snapshot) {
      if (!snapshot || !snapshot.conversation) return;
      const convoRes = await send(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, { payload: snapshot.conversation });
      if (!convoRes || !convoRes.ok) {
        throw new Error((convoRes && convoRes.error && convoRes.error.message) || "upsertConversation failed");
      }
      const convo = convoRes.data;
      const msgRes = await send(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, {
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
      let manualSaveInFlight = false;
      let onStorageChanged = null;

      function toInpageEligibleCollector(collector) {
        if (!collector) return null;
        if (!shouldAllowInpageCollector(collector.id)) return null;
        return collector;
      }

      function stop() {
        if (stopped) return;
        stopped = true;
        try {
          if (onStorageChanged && chrome && chrome.storage && chrome.storage.onChanged
            && typeof chrome.storage.onChanged.removeListener === "function") {
            chrome.storage.onChanged.removeListener(onStorageChanged);
          }
        } catch (_e) {
          // ignore
        }
        inpageButton && inpageButton.cleanupButtons && inpageButton.cleanupButtons("");
        observer && observer.stop && observer.stop();
      }

      if (runtime && typeof runtime.onInvalidated === "function") {
        runtime.onInvalidated(() => stop());
      }

      // Manual button: trigger an immediate capture and save once.
      const clickSave = async () => {
        if (stopped) return;
        if (manualSaveInFlight) {
          showInpageTip("Saving...", "loading");
          return;
        }
        manualSaveInFlight = true;
        try {
          const collector = getCollector() || getInpageCollector();
          const inpageCollector = toInpageEligibleCollector(collector) || getInpageCollector();
          if (!inpageCollector) return;
          if (inpageCollector.id === "web") {
            await runManualSaveFlow({
              startText: "Saving...",
              run: async () => {
                const res = await send(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB);
                if (!res || !res.ok) {
                  const msg = (res && res.error && res.error.message) ? String(res.error.message) : "Fetch failed";
                  throw new Error(msg);
                }
                return res;
              }
            });
            return;
          }
          if (typeof inpageCollector.capture !== "function") return;
          await runManualSaveFlow({
            startText: typeof inpageCollector.prepareManualCapture === "function" ? "Loading full history..." : "Saving...",
            run: async () => {
              if (typeof inpageCollector.prepareManualCapture === "function") {
                await inpageCollector.prepareManualCapture();
                showInpageTip("Saving...", "loading");
              }
              const snapshot = await Promise.resolve(inpageCollector.capture({ manual: true }));
              if (!snapshot) throw new Error("No visible conversation found");
              const saved = await saveSnapshot(snapshot);
              if (!saved) throw new Error("No visible conversation found");
              return saved;
            }
          });
        } catch (_e) {
          // Error tip already shown in runManualSaveFlow().
        } finally {
          manualSaveInFlight = false;
        }
      };

      const openPopupPanel = async () => {
        try {
          const res = await send(UI_MESSAGE_TYPES.OPEN_EXTENSION_POPUP);
          if (!res || !res.ok) {
            showInpageTip("Click toolbar icon to open panel", "error");
          }
        } catch (_e) {
          showInpageTip("Click toolbar icon to open panel", "error");
        }
      };

      const showComboLine = (payload) => {
        const level = payload && Number(payload.level);
        if (!Number.isFinite(level)) return;
        const line = pickLineByLevel(level);
        if (!line) return;
        showInpageTip(line);
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
            const modelPicker = NS.notionAiModelPicker;
            modelPicker && typeof modelPicker.maybeApply === "function" && modelPicker.maybeApply();

            const collector = getCollector();
            const inpageCollector = toInpageEligibleCollector(collector) || getInpageCollector();
            inpageButton && inpageButton.cleanupButtons && inpageButton.cleanupButtons(inpageCollector && inpageCollector.id);
            inpageButton && inpageButton.ensureInpageButton && inpageButton.ensureInpageButton({
              collectorId: inpageCollector ? inpageCollector.id : undefined,
              onClick: clickSave,
              onDoubleClick: openPopupPanel,
              onCombo: showComboLine
            });
            if (!collector || typeof collector.capture !== "function") return;
            const snapshot = await Promise.resolve(collector.capture());
            if (!snapshot) return;
            const inc = NS.incrementalUpdater && NS.incrementalUpdater.computeIncremental(snapshot);
            if (!inc || !inc.changed) return;
            const saved = await saveSnapshot(inc.snapshot);
            if (saved) showInpageTip("Saved", "ok");
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

      try {
        if (chrome && chrome.storage && chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === "function") {
          onStorageChanged = (changes, areaName) => {
            if (areaName !== "local") return;
            if (!changes || !Object.prototype.hasOwnProperty.call(changes, INPAGE_SUPPORTED_ONLY_STORAGE_KEY)) return;
            inpageSupportedOnly = normalizeInpageSupportedOnly(
              changes[INPAGE_SUPPORTED_ONLY_STORAGE_KEY] && changes[INPAGE_SUPPORTED_ONLY_STORAGE_KEY].newValue
            );
          };
          chrome.storage.onChanged.addListener(onStorageChanged);
        }
      } catch (_e) {
        // ignore
      }

      return {
        start() {
          if (stopped) return;
          readInpageSupportedOnlySetting()
            .then((value) => {
              inpageSupportedOnly = value;
            })
            .catch(() => {
              inpageSupportedOnly = false;
            })
            .finally(() => {
              if (stopped) return;
              observer && observer.start && observer.start();
            });
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
