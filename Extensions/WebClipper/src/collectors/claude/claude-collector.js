(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return /(^|\.)claude\.ai$/.test(hostname);
  }

  function isValidConversationUrl() {
    try {
      return /^\/chat\/.+/.test(location.pathname);
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey() {
    return NS.collectorUtils.conversationKeyFromLocation(location);
  }

  function getConversationRoot() {
    return document.querySelector("main") || document.querySelector("[role='main']") || document.body;
  }

  function inEditMode(root) {
    return NS.collectorUtils.inEditMode(root);
  }

  function isThinkingBlock(el) {
    if (!el || !el.querySelector) return false;
    // Heuristic: collapsible containers usually have aria-expanded button.
    if (el.querySelector("button[aria-expanded]")) return true;
    const cls = el.classList;
    if (cls && cls.contains("transition-all") && cls.contains("rounded-lg") && (cls.contains("border") || cls.contains("border-0.5"))) return true;
    return false;
  }

  function extractOnlyFormalResponse(container) {
    if (!container) return "";
    const parts = [];
    const children = Array.from(container.children || []);
    if (!children.length) {
      return NS.normalize.normalizeText(container.innerText || container.textContent || "");
    }
    for (const child of children) {
      if (isThinkingBlock(child)) continue;
      const t = NS.normalize.normalizeText(child.innerText || child.textContent || "");
      if (t) parts.push(t);
    }
    return NS.normalize.normalizeText(parts.join("\n\n"));
  }

  function collectMessages() {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const containers = Array.from(root.querySelectorAll("[data-test-render-count]"));
    if (!containers.length) return [];

    const out = [];
    const utils = NS.collectorUtils || {};
    const extractImages = typeof utils.extractImageUrlsFromElement === "function" ? utils.extractImageUrlsFromElement : null;
    const appendImageMd = typeof utils.appendImageMarkdown === "function" ? utils.appendImageMarkdown : null;
    let seq = 0;
    for (const c of containers) {
      const user = c.querySelector("[data-testid='user-message']");
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

      const ai = c.querySelector(".font-claude-response") || c.querySelector("[data-testid='assistant-message']") || null;
      if (ai) {
        const text = extractOnlyFormalResponse(ai);
        const imageUrls = extractImages ? extractImages(ai) : [];
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
        source: "claude",
        conversationKey: findConversationKey(),
        title: document.title || "Claude",
        url: location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const api = { capture, getRoot: getConversationRoot };
  NS.collectors = NS.collectors || {};
  NS.collectors.claude = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "claude", matches, collector: api });
  }
})();
