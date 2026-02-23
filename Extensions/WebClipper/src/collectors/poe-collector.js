(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function matches(loc) {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return /(^|\.)poe\.com$/.test(hostname);
  }

  function isValidConversationUrl() {
    try {
      const p = String(location.pathname || "");
      if (!p || p === "/") return false;
      // Exclude some well-known non-chat routes to reduce accidental activation.
      if (/^\/(login|logout|settings|explore|pricing|subscriptions)(\/|$)/.test(p)) return false;
      return true;
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey() {
    return NS.collectorUtils && typeof NS.collectorUtils.conversationKeyFromLocation === "function"
      ? NS.collectorUtils.conversationKeyFromLocation(location)
      : "";
  }

  function findTitle() {
    const selectors = [
      "div[class*='BaseNavbar_chatTitleItem__'] p[class*='ChatHeader_titleText__']",
      "div[class*='ChatHeader_titleRow__'] p[class*='ChatHeader_titleText__']",
      "p[class*='ChatHeader_titleText__']",
      "a[class*='BotHeader_title__'] p",
      "div[class*='BotHeader_textContainer__'] p",
      "h1"
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = node && node.textContent ? node.textContent.trim() : "";
      if (text) return text;
    }
    return document.title || "Poe";
  }

  function getConversationRoot() {
    // Poe groups messages by date buckets:
    // tupleGroupContainer -> (MessageDate label) + (one or more messageTuple)
    // If we pick only the first messageTuple's parent, we may only capture one date bucket.
    const group = document.querySelector("div[class*='ChatMessagesView_tupleGroupContainer__']");
    if (group && group.parentElement) return group.parentElement;

    const tuple = document.querySelector("div[class*='ChatMessagesView_messageTuple__']");
    if (tuple) {
      const tupleGroup = tuple.closest ? tuple.closest("div[class*='ChatMessagesView_tupleGroupContainer__']") : null;
      if (tupleGroup && tupleGroup.parentElement) return tupleGroup.parentElement;
      if (tuple.parentElement) return tuple.parentElement;
    }

    const msg = document.querySelector("div[class*='ChatMessage_chatMessage__'][id^='message-']");
    if (msg && msg.parentElement) return msg.parentElement;

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
    if (!wrapper || !wrapper.querySelector) return false;
    return !!(
      wrapper.querySelector("[class*='ChatMessage_rightSideMessageWrapper__']")
      || wrapper.querySelector("[class*='Message_rightSideMessageBubble__']")
      || wrapper.querySelector("[class*='Message_rightSideMessageRow__']")
    );
  }

  function isAssistantWrapper(wrapper) {
    if (!wrapper || !wrapper.querySelector) return false;
    return !!(
      wrapper.querySelector("[class*='LeftSideMessageHeader_leftSideMessageHeader__']")
      || wrapper.querySelector("[class*='Message_leftSideMessageBubble__']")
      || wrapper.querySelector("[class*='Message_leftSideMessageRow__']")
    );
  }

  function contentNodeFromWrapper(wrapper) {
    if (!wrapper || !wrapper.querySelector) return wrapper;
    const textContainer = wrapper.querySelector("div[class*='Message_messageTextContainer__']");
    const selectable = textContainer ? textContainer.querySelector("div[class*='Message_selectableText__']") : null;
    return selectable || textContainer || wrapper;
  }

  function imageScopeFromWrapper(wrapper) {
    if (!wrapper || !wrapper.querySelector) return wrapper;
    const bubble = wrapper.querySelector("div[class*='Message_messageBubbleWrapper__']") || wrapper;
    return bubble.querySelector("div[class*='Message_messageTextContainer__']") || bubble;
  }

  function getMessageWrappers(root) {
    const scope = root || document;
    const out = [];

    const tuples = Array.from(scope.querySelectorAll("div[class*='ChatMessagesView_messageTuple__']"));
    for (const t of tuples) {
      const msgs = Array.from(t.querySelectorAll("div[class*='ChatMessage_chatMessage__']"));
      for (const m of msgs) out.push(m);
    }

    if (!out.length) {
      const msgs = Array.from(scope.querySelectorAll("div[class*='ChatMessage_chatMessage__'][id^='message-']"));
      out.push(...msgs);
    }

    const sorted = sortByDomOrder(out);
    // De-dup nested or repeated candidates.
    const finalNodes = [];
    for (const node of sorted) {
      if (!node) continue;
      const isChild = finalNodes.some((p) => p && p.contains && p.contains(node));
      if (!isChild) finalNodes.push(node);
    }
    return finalNodes;
  }

  function messageKeyFromWrapper(wrapper, role, contentText, sequence) {
    const id = wrapper && wrapper.getAttribute ? String(wrapper.getAttribute("id") || "") : "";
    if (id) return id;
    return NS.normalize && typeof NS.normalize.makeFallbackMessageKey === "function"
      ? NS.normalize.makeFallbackMessageKey({ role, contentText, sequence })
      : String(sequence);
  }

  function collectMessages({ allowEditing } = {}) {
    const root = getConversationRoot();
    if (!root) return [];
    if (!allowEditing && inEditMode(root)) return [];

    const wrappers = getMessageWrappers(root);
    if (!wrappers.length) return [];

    const utils = NS.collectorUtils || {};
    const extractImages = typeof utils.extractImageUrlsFromElement === "function" ? utils.extractImageUrlsFromElement : null;
    const appendImageMd = typeof utils.appendImageMarkdown === "function" ? utils.appendImageMarkdown : null;

    const out = [];
    let seq = 0;
    for (const w of wrappers) {
      const role = isUserWrapper(w) ? "user" : (isAssistantWrapper(w) ? "assistant" : "");
      if (!role) continue;

      const node = contentNodeFromWrapper(w);
      const raw = node && (node.innerText || node.textContent) ? (node.innerText || node.textContent) : "";
      const contentText = NS.normalize && typeof NS.normalize.normalizeText === "function"
        ? NS.normalize.normalizeText(raw)
        : String(raw || "").trim();

      const imageUrls = extractImages ? extractImages(imageScopeFromWrapper(w)) : [];
      if (!contentText && !imageUrls.length) continue;

      const baseMarkdown = contentText || "";
      const contentMarkdown = appendImageMd ? appendImageMd(baseMarkdown, imageUrls) : baseMarkdown;

      out.push({
        messageKey: messageKeyFromWrapper(w, role, contentText, seq),
        role,
        contentText: contentText || "",
        contentMarkdown,
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
        source: "poe",
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
  NS.collectors.poe = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "poe", matches, collector: api });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
