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

  function geminiMarkdown() {
    return NS.geminiMarkdown || {};
  }

  function getConversationRoot() {
    return document.querySelector("#chat-history") || document.querySelector("main") || document.body;
  }

  function inEditMode(root) {
    return NS.collectorUtils.inEditMode(root);
  }

  function normalizeTitle(value) {
    const text = value == null ? "" : String(value);
    if (NS.normalize && typeof NS.normalize.normalizeText === "function") {
      return NS.normalize.normalizeText(text);
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function extractConversationTitle() {
    const selectors = [
      "[data-test-id='conversation-title']",
      ".conversation-title-container .conversation-title-column [class*='gds-title']",
      ".conversation-title-container .conversation-title-column"
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const title = normalizeTitle(el.textContent || el.innerText || "");
      if (title) return title;
    }
    const pageTitle = normalizeTitle(document.title || "");
    return pageTitle || "Gemini";
  }

  function extractAssistantMarkdown(node, fallbackText) {
    const md = geminiMarkdown();
    if (typeof md.extractAssistantMarkdown === "function") {
      const markdown = md.extractAssistantMarkdown(node);
      if (markdown) return markdown;
    }
    return fallbackText || "";
  }

  function extractAssistantText(node) {
    const md = geminiMarkdown();
    if (typeof md.extractAssistantText === "function") {
      const text = md.extractAssistantText(node);
      if (text) return text;
    }
    const raw = node ? (node.innerText || node.textContent || "") : "";
    return NS.normalize.normalizeText(raw);
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

      const model = b.querySelector("model-response") || b.querySelector("model-response .model-response-text") || null;
      if (model) {
        const text = extractAssistantText(model);
        const imageUrls = extractImages ? extractImages(model) : [];
        if (text || imageUrls.length) {
          const contentText = text || "";
          const baseMarkdown = extractAssistantMarkdown(model, contentText);
          const contentMarkdown = appendImageMd ? appendImageMd(baseMarkdown || contentText, imageUrls) : (baseMarkdown || contentText);
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
        title: extractConversationTitle(),
        url: location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const api = {
    capture,
    getRoot: getConversationRoot,
    __test: {
      collectMessages,
      extractAssistantMarkdown,
      extractAssistantText
    }
  };
  NS.collectors = NS.collectors || {};
  NS.collectors.gemini = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "gemini", matches, collector: api });
  }
})();
