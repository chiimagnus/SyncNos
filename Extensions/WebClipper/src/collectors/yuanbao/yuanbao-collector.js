(function () {
  const NS = require("../collector-context.js");

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return hostname === "yuanbao.tencent.com";
  }

  function isValidConversationUrl() {
    try {
      return /^\/chat\/[^/]+\/[^/]+$/.test(location.pathname || "");
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey() {
    return NS.collectorUtils.conversationKeyFromLocation(location);
  }

  function getConversationRoot() {
    return document.querySelector(".agent-chat__list__content") || document.querySelector("main") || document.body;
  }

  function inEditMode(root) {
    return NS.collectorUtils.inEditMode(root);
  }

  function yuanbaoMarkdown() {
    return NS.yuanbaoMarkdown || {};
  }

  function collectMessages() {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const nodes = [];
    root.querySelectorAll(".agent-chat__list__item--human").forEach((el) => nodes.push({ el, role: "user" }));
    root.querySelectorAll(".agent-chat__list__item--ai").forEach((el) => nodes.push({ el, role: "assistant" }));
    if (!nodes.length) return [];

    nodes.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const out = [];
    const utils = NS.collectorUtils || {};
    const markdown = yuanbaoMarkdown();
    const extractImages = typeof utils.extractImageUrlsFromElement === "function" ? utils.extractImageUrlsFromElement : null;
    const appendImageMd = typeof utils.appendImageMarkdown === "function" ? utils.appendImageMarkdown : null;
    for (let i = 0; i < nodes.length; i += 1) {
      const { el, role } = nodes[i];
      let tEl = el;
      if (role === "user") {
        tEl = el.querySelector(".hyc-content-text") || el;
      } else {
        tEl = el.querySelector(".agent-chat__speech-text") || el.querySelector(".hyc-component-reasoner__text") || el;
      }
      const fallbackText = NS.normalize.normalizeText(tEl.innerText || tEl.textContent || "");
      const text = role === "assistant" && typeof markdown.extractAssistantText === "function"
        ? (markdown.extractAssistantText(tEl) || fallbackText)
        : fallbackText;
      const imageUrls = extractImages ? extractImages(tEl || el) : [];
      if (!text && !imageUrls.length) continue;
      const contentText = text || "";
      const baseMarkdown = role === "assistant" && typeof markdown.extractAssistantMarkdown === "function"
        ? (markdown.extractAssistantMarkdown(tEl) || contentText)
        : contentText;
      const contentMarkdown = appendImageMd ? appendImageMd(baseMarkdown, imageUrls) : baseMarkdown;
      out.push({
        messageKey: NS.normalize.makeFallbackMessageKey({ role, contentText, sequence: i }),
        role,
        contentText,
        contentMarkdown,
        sequence: i,
        updatedAt: Date.now()
      });
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
        source: "yuanbao",
        conversationKey: findConversationKey(),
        title: document.title || "Yuanbao",
        url: location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const api = { capture, getRoot: getConversationRoot };
  NS.collectors = NS.collectors || {};
  NS.collectors.yuanbao = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "yuanbao", matches, collector: api });
  }
})();
