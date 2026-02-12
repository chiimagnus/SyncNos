(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return /(^|\.)doubao\.com$/.test(hostname);
  }

  function isValidConversationUrl() {
    try {
      const p = location.pathname || "";
      if (p === "/chat" || p === "/chat/") return false;
      if (/^\/chat\/local/.test(p)) return false;
      return /^\/chat\/(?!local)[^/]+/.test(p);
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey() {
    return (location.pathname || "/").replace(/\//g, "_").replace(/^_+/, "") || location.href.split("?")[0];
  }

  function getConversationRoot() {
    return document.querySelector("[data-testid='message_list']") || document.querySelector("main") || document.body;
  }

  function inEditMode(root) {
    if (!root) return false;
    const ta = root.querySelector("textarea");
    if (!ta) return false;
    return document.activeElement === ta || ta.contains(document.activeElement);
  }

  function collectMessages() {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const containers = Array.from(document.querySelectorAll("[data-testid='union_message']"));
    if (!containers.length) return [];

    const out = [];
    let seq = 0;
    for (const c of containers) {
      const sendMessage = c.querySelector("[data-testid='send_message']");
      if (sendMessage) {
        const tEl = sendMessage.querySelector("[data-testid='message_text_content']") || sendMessage;
        const text = NS.normalize.normalizeText(tEl.innerText || tEl.textContent || "");
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

      const recv = c.querySelector("[data-testid='receive_message']");
      if (recv) {
        const all = Array.from(recv.querySelectorAll("[data-testid='message_text_content']"));
        const textEl = all.find((el) => !el.closest("[data-testid='think_block_collapse']")) || recv;
        const text = NS.normalize.normalizeText(textEl.innerText || textEl.textContent || "");
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
        source: "doubao",
        conversationKey: findConversationKey(),
        title: document.title || "Doubao",
        url: location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const api = { capture, getRoot: getConversationRoot };
  NS.collectors = NS.collectors || {};
  NS.collectors.doubao = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "doubao", matches, collector: api });
  }
})();

