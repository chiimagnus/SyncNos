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
    return (location.pathname || "/").replace(/\//g, "_").replace(/^_+/, "") || location.href.split("?")[0];
  }

  function getConversationRoot() {
    return document.querySelector("main") || document.querySelector("[role='main']") || document.body;
  }

  function inEditMode(root) {
    if (!root) return false;
    const ta = root.querySelector("textarea");
    if (!ta) return false;
    return document.activeElement === ta || ta.contains(document.activeElement);
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
    let seq = 0;
    for (const c of containers) {
      const user = c.querySelector("[data-testid='user-message']");
      if (user) {
        const text = NS.normalize.normalizeText(user.innerText || user.textContent || "");
        if (text) {
          out.push({
            messageKey: NS.normalize.makeFallbackMessageKey({ role: "user", contentText: text, sequence: seq }),
            role: "user",
            contentText: text,
            sequence: seq,
            updatedAt: Date.now()
          });
          seq += 1;
        }
      }

      const ai = c.querySelector(".font-claude-response") || c.querySelector("[data-testid='assistant-message']") || null;
      if (ai) {
        const text = extractOnlyFormalResponse(ai);
        if (text) {
          out.push({
            messageKey: NS.normalize.makeFallbackMessageKey({ role: "assistant", contentText: text, sequence: seq }),
            role: "assistant",
            contentText: text,
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

