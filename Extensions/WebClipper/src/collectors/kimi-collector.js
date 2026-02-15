(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return hostname === "kimi.moonshot.cn" || /(^|\.)kimi\.com$/.test(hostname);
  }

  function isValidConversationUrl() {
    try {
      return /^\/chat\/[^/]+/.test(location.pathname || "");
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey() {
    return NS.collectorUtils.conversationKeyFromLocation(location);
  }

  function getConversationRoot() {
    return document.querySelector(".chat-content") || document.querySelector("main") || document.body;
  }

  function inEditMode(root) {
    return NS.collectorUtils.inEditMode(root);
  }

  function collectMessages() {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const items = Array.from(root.querySelectorAll(".chat-content-item"));
    if (!items.length) return [];

    const out = [];
    let seq = 0;
    for (const item of items) {
      const isUser = item.classList && item.classList.contains("chat-content-item-user");
      const isAssistant = item.classList && item.classList.contains("chat-content-item-assistant");
      if (!isUser && !isAssistant) continue;
      const role = isUser ? "user" : "assistant";

      let text = "";
      if (isUser) {
        const parts = Array.from(item.querySelectorAll(".user-content")).map((el) => NS.normalize.normalizeText(el.innerText || el.textContent || "")).filter(Boolean);
        text = NS.normalize.normalizeText(parts.join("\n\n"));
      } else {
        const candidates = [];
        item.querySelectorAll(".markdown-container, .editor-content").forEach((el) => {
          if (el.closest(".think-stage")) return;
          candidates.push(el);
        });
        candidates.sort((a, b) => {
          const pos = a.compareDocumentPosition(b);
          if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });
        const parts = candidates.map((el) => NS.normalize.normalizeText(el.innerText || el.textContent || "")).filter(Boolean);
        text = NS.normalize.normalizeText(parts.join("\n\n"));
      }

      if (!text) continue;
      out.push({
        messageKey: NS.normalize.makeFallbackMessageKey({ role, contentText: text, sequence: seq }),
        role,
        contentText: text,
        sequence: seq,
        updatedAt: Date.now()
      });
      seq += 1;
    }
    return out;
  }

  function capture() {
    if (!matches({ hostname: location.hostname }) || !isValidConversationUrl()) return null;
    const messages = collectMessages();
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: "chat",
        source: "kimi",
        conversationKey: findConversationKey(),
        title: document.title || "Kimi",
        url: location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const api = { capture, getRoot: getConversationRoot };
  NS.collectors = NS.collectors || {};
  NS.collectors.kimi = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "kimi", matches, collector: api });
  }
})();
