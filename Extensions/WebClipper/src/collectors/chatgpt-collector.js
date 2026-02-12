(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function findConversationKey() {
    // Prefer URL path for ChatGPT. Works for both chat.openai.com and chatgpt.com.
    const m = location.pathname.match(/\/c\/([^/?#]+)/) || location.pathname.match(/\/chat\/([^/?#]+)/);
    if (m && m[1]) return m[1];
    return location.href;
  }

  function findTitle() {
    const h = document.querySelector("h1");
    const t = h && h.textContent ? h.textContent.trim() : "";
    return t || document.title || "ChatGPT";
  }

  function collectMessages() {
    // Heuristic: collect visible text from assistant/user message containers.
    const nodes = Array.from(document.querySelectorAll("main [data-message-author-role], main article"));
    const out = [];
    let seq = 0;
    for (const n of nodes) {
      const roleAttr = n.getAttribute && n.getAttribute("data-message-author-role");
      const role = roleAttr === "user" ? "user" : roleAttr === "assistant" ? "assistant" : null;
      const text = n.innerText ? n.innerText.trim() : "";
      if (!text) continue;
      const contentText = text;
      const messageKey = roleAttr && n.getAttribute("data-message-id")
        ? n.getAttribute("data-message-id")
        : NS.normalize.makeFallbackMessageKey({ role: role || "assistant", contentText, sequence: seq });
      out.push({
        messageKey,
        role: role || "assistant",
        contentText,
        sequence: seq,
        updatedAt: Date.now()
      });
      seq += 1;
    }
    return out;
  }

  function capture() {
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
  NS.collectors.chatgpt = { capture };
})();

