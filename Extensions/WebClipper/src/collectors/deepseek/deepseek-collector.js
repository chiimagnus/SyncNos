(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return hostname === "chat.deepseek.com";
  }

  function isValidConversationUrl() {
    try {
      return /^\/a\/chat\/s\/[^/]+$/.test(location.pathname || "");
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey() {
    return NS.collectorUtils.conversationKeyFromLocation(location);
  }

  function getConversationRoot() {
    return document.querySelector(".dad65929") || document.querySelector("main") || document.body;
  }

  function inEditMode(root) {
    return NS.collectorUtils.inEditMode(root);
  }

  function deepseekMarkdown() {
    return NS.deepseekMarkdown || {};
  }

  function collectMessages() {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const nodes = Array.from(root.querySelectorAll("._9663006, ._4f9bf79._43c05b5"));
    if (!nodes.length) return [];

    const out = [];
    const utils = NS.collectorUtils || {};
    const markdown = deepseekMarkdown();
    const extractImages = typeof utils.extractImageUrlsFromElement === "function" ? utils.extractImageUrlsFromElement : null;
    const appendImageMd = typeof utils.appendImageMarkdown === "function" ? utils.appendImageMarkdown : null;
    let seq = 0;
    for (const el of nodes) {
      const isUser = el.classList && el.classList.contains("_9663006");
      const role = isUser ? "user" : "assistant";
      let text = "";
      let contentNode = el;
      if (isUser) {
        const u = el.querySelector(".fbb737a4") || el;
        contentNode = u;
        text = NS.normalize.normalizeText(u.innerText || u.textContent || "");
      } else {
        const ds = el.querySelector(".ds-message") || el;
        // Prefer direct markdown child for formal response; avoid think blocks.
        const directMarkdown = Array.from(ds.children || []).find((c) => c && c.classList && c.classList.contains("ds-markdown"));
        const contentEl = directMarkdown || ds.querySelector(".ds-markdown") || ds;
        contentNode = contentEl;
        const fallbackText = NS.normalize.normalizeText(contentEl.innerText || contentEl.textContent || "");
        text = typeof markdown.extractAssistantText === "function"
          ? (markdown.extractAssistantText(contentEl) || fallbackText)
          : fallbackText;
      }
      const imageUrls = extractImages ? extractImages(contentNode || el) : [];
      if (!text && !imageUrls.length) continue;
      const contentText = text || "";
      const baseMarkdown = !isUser && typeof markdown.extractAssistantMarkdown === "function"
        ? (markdown.extractAssistantMarkdown(contentNode) || contentText)
        : contentText;
      const contentMarkdown = appendImageMd ? appendImageMd(baseMarkdown, imageUrls) : baseMarkdown;
      out.push({
        messageKey: NS.normalize.makeFallbackMessageKey({ role, contentText, sequence: seq }),
        role,
        contentText,
        contentMarkdown,
        sequence: seq,
        updatedAt: Date.now()
      });
      seq += 1;
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
        source: "deepseek",
        conversationKey: findConversationKey(),
        title: document.title || "DeepSeek",
        url: location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const api = { capture, getRoot: getConversationRoot };
  NS.collectors = NS.collectors || {};
  NS.collectors.deepseek = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "deepseek", matches, collector: api });
  }
})();
