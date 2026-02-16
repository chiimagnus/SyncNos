(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

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
    for (let i = 0; i < nodes.length; i += 1) {
      const { el, role } = nodes[i];
      let tEl = el;
      if (role === "user") {
        tEl = el.querySelector(".hyc-content-text") || el;
      } else {
        tEl = el.querySelector(".agent-chat__speech-text") || el.querySelector(".hyc-component-reasoner__text") || el;
      }
      const text = NS.normalize.normalizeText(tEl.innerText || tEl.textContent || "");
      if (!text) continue;
      out.push({
        messageKey: NS.normalize.makeFallbackMessageKey({ role, contentText: text, sequence: i }),
        role,
        contentText: text,
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
