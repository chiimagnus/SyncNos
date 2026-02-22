(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return /(^|\.)gemini\.google\.com$/.test(hostname);
  }

  function isValidConversationUrl() {
    try {
      const p = location.pathname || "";
      if (p === "/app") return false;
      if (/^\/gem\/[^/]+$/.test(p)) return false;
      return /^\/app\/[^/]+$/.test(p) || /^\/gem\/[^/]+\/[^/]+$/.test(p) || /\/app\/[^/]+$/.test(p) || /\/gem\/[^/]+\/[^/]+$/.test(p);
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey() {
    return NS.collectorUtils.conversationKeyFromLocation(location);
  }

  function getConversationRoot() {
    return document.querySelector("#chat-history") || document.querySelector("main") || document.body;
  }

  function inEditMode(root) {
    return NS.collectorUtils.inEditMode(root);
  }

  function collectMessages() {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const blocks = Array.from(root.querySelectorAll(".conversation-container"));
    if (!blocks.length) return [];

    const out = [];
    const utils = NS.collectorUtils || {};
    const extractImages = typeof utils.extractImageUrlsFromElement === "function" ? utils.extractImageUrlsFromElement : null;
    const appendImageMd = typeof utils.appendImageMarkdown === "function" ? utils.appendImageMarkdown : null;
    let seq = 0;
    for (const b of blocks) {
      const user = b.querySelector("user-query .query-text") || b.querySelector("[data-test-id='user-message']") || null;
      if (user) {
        const text = NS.normalize.normalizeText(user.innerText || user.textContent || "");
        const imageUrls = extractImages ? extractImages(user) : [];
        if (text || imageUrls.length) {
          const contentText = text || "";
          const contentMarkdown = appendImageMd ? appendImageMd(contentText, imageUrls) : contentText;
          out.push({
            messageKey: NS.normalize.makeFallbackMessageKey({ role: "user", contentText, sequence: seq }),
            role: "user",
            contentText,
            contentMarkdown,
            sequence: seq,
            updatedAt: Date.now()
          });
          seq += 1;
        }
      }

      const model = b.querySelector("model-response .model-response-text") || b.querySelector("model-response") || null;
      if (model) {
        const text = NS.normalize.normalizeText(model.innerText || model.textContent || "");
        const imageUrls = extractImages ? extractImages(model) : [];
        if (text || imageUrls.length) {
          const contentText = text || "";
          const contentMarkdown = appendImageMd ? appendImageMd(contentText, imageUrls) : contentText;
          out.push({
            messageKey: NS.normalize.makeFallbackMessageKey({ role: "assistant", contentText, sequence: seq }),
            role: "assistant",
            contentText,
            contentMarkdown,
            sequence: seq,
            updatedAt: Date.now()
          });
          seq += 1;
        }
      }
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
        source: "gemini",
        conversationKey: findConversationKey(),
        title: document.title || "Gemini",
        url: location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const api = { capture, getRoot: getConversationRoot };
  NS.collectors = NS.collectors || {};
  NS.collectors.gemini = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "gemini", matches, collector: api });
  }
})();
