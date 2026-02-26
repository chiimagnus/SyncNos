(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return /(^|\.)chatgpt\.com$/.test(hostname) || /(^|\.)chat\.openai\.com$/.test(hostname);
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

  function userContentNode(element) {
    return element.querySelector(".whitespace-pre-wrap") || element;
  }

  function assistantContentNode(element) {
    return element.querySelector(".markdown.prose") || element.querySelector(".markdown") || element;
  }

  function getTurnWrappers(root) {
    const scope = root || document;
    const uniqueNodes = new Set();

    scope.querySelectorAll("div[data-testid='conversation-turn']").forEach((el) => uniqueNodes.add(el));
    scope.querySelectorAll("[data-message-author-role]").forEach((el) => uniqueNodes.add(el));
    scope.querySelectorAll(".agent-turn").forEach((el) => uniqueNodes.add(el));

    const sorted = Array.from(uniqueNodes);
    sorted.sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    const finalNodes = [];
    for (const node of sorted) {
      const isChild = finalNodes.some((parent) => parent.contains(node));
      if (!isChild) finalNodes.push(node);
    }
    return finalNodes;
  }

  function roleFromWrapper(wrapper) {
    const direct = wrapper && wrapper.getAttribute ? wrapper.getAttribute("data-message-author-role") : "";
    if (direct === "user" || direct === "assistant") return direct;

    const inner = wrapper && wrapper.querySelector ? wrapper.querySelector("[data-message-author-role]") : null;
    const innerRole = inner && inner.getAttribute ? inner.getAttribute("data-message-author-role") : "";
    if (innerRole === "user" || innerRole === "assistant") return innerRole;

    if (wrapper && wrapper.classList && wrapper.classList.contains("agent-turn")) return "assistant";
    if (wrapper && wrapper.querySelector && wrapper.querySelector("div[class*='user']")) return "user";
    return "assistant";
  }

  function collectMessages({ allowEditing } = {}) {
    const root = getConversationRoot();
    if (!root) return [];
    if (!allowEditing && inEditMode(root)) return [];

    const wrappers = getTurnWrappers(root);

    // Extra fallback for some recent layouts where only turn articles are present.
    if (!wrappers.length) {
      const turns = Array.from(root.querySelectorAll("article[data-testid^='conversation-turn-']"));
      for (const turn of turns) wrappers.push(turn);
    }

    const out = [];
    const utils = NS.collectorUtils || {};
    const extractImages = typeof utils.extractImageUrlsFromElement === "function" ? utils.extractImageUrlsFromElement : null;
    const appendImageMd = typeof utils.appendImageMarkdown === "function" ? utils.appendImageMarkdown : null;
    for (let i = 0; i < wrappers.length; i += 1) {
      const el = wrappers[i];
      const role = roleFromWrapper(el);
      const node = role === "user" ? userContentNode(el) : assistantContentNode(el);
      const raw = node ? (node.innerText || node.textContent || "") : "";
      const contentText = NS.normalize.normalizeText(raw);
      const imageUrls = (() => {
        if (!extractImages) return [];
        const primary = extractImages(node || el);
        if (!node || node === el) return primary;
        const secondary = extractImages(el);
        return Array.from(new Set(primary.concat(secondary)));
      })();
      if (!contentText && !imageUrls.length) continue;
      const baseMarkdown = contentText || "";
      const contentMarkdown = appendImageMd ? appendImageMd(baseMarkdown, imageUrls) : baseMarkdown;
      const messageId = el.getAttribute && (el.getAttribute("data-message-id") || el.id);
      const messageKey = messageId || NS.normalize.makeFallbackMessageKey({ role, contentText, sequence: i });
      out.push({
        messageKey,
        role,
        contentText,
        contentMarkdown,
        sequence: i,
        updatedAt: Date.now()
      });
    }

    return out;
  }

  function capture(options) {
    if (!matches({ hostname: location.hostname })) return null;
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
