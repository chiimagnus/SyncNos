(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return /(^|\.)chatgpt\.com$/.test(hostname) || /(^|\.)chat\.openai\.com$/.test(hostname);
  }

  function isChatHost() {
    try {
      const hostname = location.hostname;
      if (!hostname.includes("chatgpt.com") && !hostname.includes("chat.openai.com")) return false;
      return true;
    } catch (_e) {
      return false;
    }
  }

  function findConversationIdFromUrl() {
    // Prefer URL path for ChatGPT. Works for both chat.openai.com and chatgpt.com.
    const m = location.pathname.match(/^\/c\/([^/?#]+)/) || location.pathname.match(/^\/g\/[^/]+\/c\/([^/?#]+)/);
    return m && m[1] ? m[1] : "";
  }

  function makeFallbackConversationKey(messages) {
    const firstUser = Array.isArray(messages) ? messages.find((m) => m && m.role === "user" && m.contentText) : null;
    const seed = `${location.hostname}|${location.pathname}|${firstUser ? firstUser.contentText : ""}`;
    const hash = NS.normalize && NS.normalize.fnv1a32 ? NS.normalize.fnv1a32(seed) : String(Date.now());
    return `fallback_${hash}`;
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

  function collectMessages({ allowEditing } = {}) {
    const root = getConversationRoot();
    if (!root) return [];
    if (!allowEditing && inEditMode(root)) return [];

    const all = [];
    const userNodes = Array.from(root.querySelectorAll("div[data-message-author-role='user']"));
    const assistantNodes = Array.from(root.querySelectorAll("div[data-message-author-role='assistant']"));
    for (const el of userNodes) all.push({ el, role: "user" });
    for (const el of assistantNodes) all.push({ el, role: "assistant" });

    // Fallback for newer layouts where role attributes are unstable/missing.
    if (!all.length) {
      const turns = Array.from(root.querySelectorAll("article[data-testid^='conversation-turn-']"));
      for (const turn of turns) {
        const assistantMarker = turn.querySelector(".markdown.prose, .markdown");
        if (assistantMarker) {
          all.push({ el: turn, role: "assistant" });
          continue;
        }
        const userMarker = turn.querySelector(".whitespace-pre-wrap");
        if (userMarker) {
          all.push({ el: turn, role: "user" });
        }
      }
    }

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

  function capture(options) {
    if (!isChatHost()) return null;
    const messages = collectMessages({ allowEditing: !!(options && options.manual) });
    if (!messages.length) return null;
    const conversationKey = findConversationIdFromUrl() || makeFallbackConversationKey(messages);
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
