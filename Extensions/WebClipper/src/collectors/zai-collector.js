(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return hostname === "chat.z.ai";
  }

  function findConversationIdFromUrl() {
    const m = String(location.pathname || "").match(/^\/c\/([^/?#]+)/);
    return m && m[1] ? m[1] : "";
  }

  function isValidConversationUrl() {
    try {
      return !!findConversationIdFromUrl();
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey() {
    return findConversationIdFromUrl() || (NS.collectorUtils && NS.collectorUtils.conversationKeyFromLocation
      ? NS.collectorUtils.conversationKeyFromLocation(location)
      : "");
  }

  function findTitle() {
    return document.title || "z.ai";
  }

  function getConversationRoot() {
    return document.querySelector("main") || document.querySelector("[role='main']") || document.body;
  }

  function inEditMode(root) {
    const utils = NS.collectorUtils;
    if (utils && typeof utils.inEditMode === "function") return utils.inEditMode(root);
    return false;
  }

  function sortByDomOrder(nodes) {
    const sorted = Array.from(nodes || []);
    sorted.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return sorted;
  }

  function isUserWrapper(wrapper) {
    if (!wrapper) return false;
    if (wrapper.classList && wrapper.classList.contains("user-message")) return true;
    return !!(wrapper.querySelector && wrapper.querySelector(".user-message, .chat-user"));
  }

  function isAssistantWrapper(wrapper) {
    if (!wrapper) return false;
    if (wrapper.classList && wrapper.classList.contains("chat-assistant")) return true;
    return !!(wrapper.querySelector && wrapper.querySelector(".chat-assistant"));
  }

  function removeThinkingNodes(container) {
    if (!container || !container.querySelectorAll) return container;
    const selectors = [
      ".thinking-chain-container",
      // Some layouts render the thinking content in a separate block (often hidden/collapsed).
      ".thinking-block",
      // z.ai thinking block uses `data-direct="false"` in current DOM.
      "[data-direct='false']"
    ];
    for (const sel of selectors) {
      container.querySelectorAll(sel).forEach((el) => {
        try {
          el.remove();
        } catch (_e) {
          // ignore
        }
      });
    }
    return container;
  }

  function removeNonContentNodes(container) {
    if (!container || !container.querySelectorAll) return container;
    // Strip UI/control elements that can leak into textContent when innerText is unreliable.
    container.querySelectorAll("button, svg, path, textarea, input, select, option, script, style").forEach((el) => {
      try {
        el.remove();
      } catch (_e) {
        // ignore
      }
    });
    return container;
  }

  function extractTextFromSanitizedClone(clone) {
    if (!clone) return "";

    // Prefer innerText (keeps line breaks). Must not mutate the real DOM, or we'd
    // self-trigger the MutationObserver in auto-capture.
    const inner = typeof clone.innerText === "string" ? clone.innerText : "";
    if (inner && inner.trim()) return inner;

    const blockTags = new Set([
      "P",
      "DIV",
      "LI",
      "UL",
      "OL",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "BLOCKQUOTE",
      "PRE",
      "SECTION",
      "ARTICLE"
    ]);

    const parts = [];
    const TEXT_NODE = typeof Node !== "undefined" && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
    const ELEMENT_NODE = typeof Node !== "undefined" && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

    function walk(node) {
      if (!node) return;
      const t = node.nodeType;
      if (t === TEXT_NODE) {
        const v = node.nodeValue ? String(node.nodeValue) : "";
        if (v) parts.push(v);
        return;
      }
      if (t !== ELEMENT_NODE) return;

      const tag = node.tagName ? String(node.tagName).toUpperCase() : "";
      if (tag === "BR") {
        parts.push("\n");
        return;
      }

      const children = node.childNodes ? Array.from(node.childNodes) : [];
      for (const c of children) walk(c);

      if (blockTags.has(tag)) {
        parts.push("\n\n");
      }
    }

    walk(clone);
    return parts.join("");
  }

  function extractUserText(wrapper) {
    const node = (wrapper && wrapper.querySelector)
      ? (wrapper.querySelector(".whitespace-pre-wrap") || wrapper)
      : wrapper;
    const text = node && (node.innerText || node.textContent) ? (node.innerText || node.textContent) : "";
    return NS.normalize.normalizeText(text);
  }

  function extractAssistantText(wrapper) {
    if (!wrapper || !wrapper.querySelector) return "";
    const content = wrapper.querySelector("#response-content-container") || wrapper.querySelector(".chat-assistant") || wrapper;

    let node = content;
    try {
      const cloned = content.cloneNode(true);
      removeThinkingNodes(cloned);
      removeNonContentNodes(cloned);
      node = cloned;
    } catch (_e) {
      node = content;
    }

    const raw = node ? extractTextFromSanitizedClone(node) : "";
    return NS.normalize.normalizeText(raw);
  }

  function getMessageWrappers(root) {
    const scope = root || document;
    const candidates = Array.from(scope.querySelectorAll("div[id^='message-']"));
    // Keep only wrappers we can classify; avoid catching nested structural nodes if any.
    const filtered = candidates.filter((w) => isUserWrapper(w) || isAssistantWrapper(w));
    return sortByDomOrder(filtered);
  }

  function messageKeyFromWrapper(wrapper, role, contentText, sequence) {
    const id = wrapper && wrapper.getAttribute ? String(wrapper.getAttribute("id") || "") : "";
    if (id) return id;
    return NS.normalize.makeFallbackMessageKey({ role, contentText, sequence });
  }

  function collectMessages({ allowEditing } = {}) {
    const root = getConversationRoot();
    if (!root) return [];
    if (!allowEditing && inEditMode(root)) return [];

    const wrappers = getMessageWrappers(root);
    if (!wrappers.length) return [];

    const out = [];
    let seq = 0;
    for (const w of wrappers) {
      const role = isUserWrapper(w) ? "user" : (isAssistantWrapper(w) ? "assistant" : "");
      if (!role) continue;
      const contentText = role === "user" ? extractUserText(w) : extractAssistantText(w);
      if (!contentText) continue;
      out.push({
        messageKey: messageKeyFromWrapper(w, role, contentText, seq),
        role,
        contentText,
        sequence: seq,
        updatedAt: Date.now()
      });
      seq += 1;
    }
    return out;
  }

  function capture(options) {
    if (!matches({ hostname: location.hostname }) || !isValidConversationUrl()) return null;
    const messages = collectMessages({ allowEditing: !!(options && options.manual) });
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: "chat",
        source: "zai",
        conversationKey: findConversationKey(),
        title: findTitle(),
        url: location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const api = { capture, getRoot: getConversationRoot };
  NS.collectors = NS.collectors || {};
  NS.collectors.zai = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "zai", matches, collector: api });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      ...api,
      __test: {
        removeThinkingNodes,
        removeNonContentNodes,
        extractTextFromSanitizedClone,
        extractAssistantText
      }
    };
  }
})();
