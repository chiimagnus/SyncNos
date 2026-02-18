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
    // Prefer innerText (preserves line breaks) but ensure the node is attached so browsers compute it reliably.
    const body = document && document.body ? document.body : null;
    if (!body || !body.appendChild) {
      return String(clone.innerText || clone.textContent || "");
    }

    const host = document.createElement("div");
    host.setAttribute("data-webclipper-temp", "true");
    host.style.cssText = [
      "position:fixed",
      "left:-99999px",
      "top:0",
      "width:1px",
      "height:1px",
      "overflow:hidden",
      "pointer-events:none"
    ].join(";");

    try {
      host.appendChild(clone);
      body.appendChild(host);
      return String(clone.innerText || host.innerText || clone.textContent || "");
    } finally {
      try {
        host.remove();
      } catch (_e) {
        // ignore
      }
    }
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
