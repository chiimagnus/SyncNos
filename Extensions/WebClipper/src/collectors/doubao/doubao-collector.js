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
    return NS.collectorUtils.conversationKeyFromLocation(location);
  }

  function getConversationRoot() {
    return document.querySelector("[data-testid='message_list']") || document.querySelector("main") || document.body;
  }

  function inEditMode(root) {
    return NS.collectorUtils.inEditMode(root);
  }

  function doubaoMarkdown() {
    return NS.doubaoMarkdown || {};
  }

  function collectMessages() {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const containers = Array.from(document.querySelectorAll("[data-testid='union_message']"));
    if (!containers.length) return [];

    const out = [];
    const utils = NS.collectorUtils || {};
    const markdown = doubaoMarkdown();
    const extractImages = typeof utils.extractImageUrlsFromElement === "function" ? utils.extractImageUrlsFromElement : null;
    const appendImageMd = typeof utils.appendImageMarkdown === "function" ? utils.appendImageMarkdown : null;
    let seq = 0;
    for (const c of containers) {
      const sendMessage = c.querySelector("[data-testid='send_message']");
      if (sendMessage) {
        const tEl = sendMessage.querySelector("[data-testid='message_text_content']") || sendMessage;
        const text = NS.normalize.normalizeText(tEl.innerText || tEl.textContent || "");
        const imageUrls = extractImages ? extractImages(sendMessage) : [];
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

      const recv = c.querySelector("[data-testid='receive_message']");
      if (recv) {
        const all = Array.from(recv.querySelectorAll("[data-testid='message_text_content']"));
        const textEl = all.find((el) => !el.closest("[data-testid='think_block_collapse']")) || recv;
        const fallbackText = NS.normalize.normalizeText(textEl.innerText || textEl.textContent || "");
        const text = typeof markdown.extractAssistantText === "function"
          ? (markdown.extractAssistantText(textEl) || fallbackText)
          : fallbackText;
        const imageUrls = extractImages ? extractImages(recv) : [];
        if (text || imageUrls.length) {
          const contentText = text || "";
          const baseMarkdown = typeof markdown.extractAssistantMarkdown === "function"
            ? (markdown.extractAssistantMarkdown(textEl) || contentText)
            : contentText;
          const contentMarkdown = appendImageMd ? appendImageMd(baseMarkdown, imageUrls) : baseMarkdown;
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
