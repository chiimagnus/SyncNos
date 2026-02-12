(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return /(^|\.)chatgpt\.com$/.test(hostname) || /(^|\.)chat\.openai\.com$/.test(hostname);
  }

  function isValidConversationUrl() {
    try {
      const hostname = location.hostname;
      const pathname = location.pathname;
      if (!hostname.includes("chatgpt.com") && !hostname.includes("chat.openai.com")) return false;
      return /^\/c\/[^/]+$/.test(pathname) || /^\/g\/[^/]+\/c\/[^/]+$/.test(pathname);
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey() {
    // Prefer URL path for ChatGPT. Works for both chat.openai.com and chatgpt.com.
    const m = location.pathname.match(/^\/c\/([^/?#]+)/) || location.pathname.match(/^\/g\/[^/]+\/c\/([^/?#]+)/);
    if (m && m[1]) return m[1];
    return location.href.split("?")[0];
  }

  function findTitle() {
    const h = document.querySelector("h1");
    const t = h && h.textContent ? h.textContent.trim() : "";
    return t || document.title || "ChatGPT";
  }

  function getConversationRoot() {
    return document.querySelector("main") || document.querySelector("[role='main']") || document.body;
  }

  function inEditMode(root) {
    if (!root) return false;
    const ta = root.querySelector("textarea");
    if (!ta) return false;
    // If a textarea is focused, user may be editing; avoid capturing partial drafts.
    return document.activeElement === ta || ta.contains(document.activeElement);
  }

  function extractUserText(element) {
    const node = element.querySelector(".whitespace-pre-wrap") || element;
    const text = node && node.innerText ? node.innerText : "";
    return NS.normalize.normalizeText(text);
  }

  function extractAssistantText(element) {
    const node =
      element.querySelector(".markdown.prose") ||
      element.querySelector(".markdown") ||
      element;
    const text = node && node.innerText ? node.innerText : "";
    return NS.normalize.normalizeText(text);
  }

  function collectMessages() {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const userNodes = Array.from(root.querySelectorAll("div[data-message-author-role='user']"));
    const assistantNodes = Array.from(root.querySelectorAll("div[data-message-author-role='assistant']"));

    const all = [];
    for (const el of userNodes) all.push({ el, role: "user" });
    for (const el of assistantNodes) all.push({ el, role: "assistant" });

    // Sort by DOM order.
    all.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const out = [];
    for (let i = 0; i < all.length; i += 1) {
      const { el, role } = all[i];
      const contentText = role === "user" ? extractUserText(el) : extractAssistantText(el);
      if (!contentText) continue;
      const messageId = el.getAttribute && (el.getAttribute("data-message-id") || el.id);
      const messageKey = messageId || NS.normalize.makeFallbackMessageKey({ role, contentText, sequence: i });
      out.push({
        messageKey,
        role,
        contentText,
        sequence: i,
        updatedAt: Date.now()
      });
    }

    return out;
  }

  function capture() {
    if (!isValidConversationUrl()) return null;
    const conversationKey = findConversationKey();
    const messages = collectMessages();
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: "chat",
        source: "chatgpt",
        conversationKey,
        title: findTitle(),
        url: location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  NS.collectors = NS.collectors || {};
  NS.collectors.chatgpt = { capture, getRoot: getConversationRoot };

  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "chatgpt", matches, collector: NS.collectors.chatgpt });
  }
})();
