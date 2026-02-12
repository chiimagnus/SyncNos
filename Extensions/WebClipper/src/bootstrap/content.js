/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function send(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...(payload || {}) }, (res) => resolve(res));
    });
  }

  function isChatGPT() {
    return /(^|\.)chatgpt\.com$/.test(location.hostname) || /(^|\.)chat\.openai\.com$/.test(location.hostname);
  }

  function isNotion() {
    return /(^|\.)notion\.so$/.test(location.hostname);
  }

  function getCollector() {
    if (isChatGPT()) return NS.collectors && NS.collectors.chatgpt;
    if (isNotion()) return NS.collectors && NS.collectors.notionai;
    return null;
  }

  async function saveSnapshot(snapshot) {
    if (!snapshot || !snapshot.conversation) return;
    const convoRes = await send("upsertConversation", { payload: snapshot.conversation });
    if (!convoRes || !convoRes.ok) return;
    const convo = convoRes.data;
    await send("upsertMessagesIncremental", {
      conversationId: convo.id,
      messages: snapshot.messages || []
    });
  }

  function startAutoCapture() {
    const collector = getCollector();
    if (!collector || typeof collector.capture !== "function") return;

    const observer = NS.runtimeObserver && NS.runtimeObserver.createObserver({
      debounceMs: 600,
      onTick: async () => {
        try {
          const snapshot = collector.capture();
          if (!snapshot) return;
          const inc = NS.incrementalUpdater && NS.incrementalUpdater.computeIncremental(snapshot);
          if (!inc || !inc.changed) return;
          await saveSnapshot(inc.snapshot);
        } catch (_e) {
          // Swallow errors in content script; surface via popup in later tasks.
        }
      }
    });

    observer && observer.start && observer.start();
  }

  startAutoCapture();
})();

