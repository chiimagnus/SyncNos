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

  function poeMarkdown() {
    return NS.poeMarkdown || {};
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

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
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
    const bubble = wrapper.querySelector("div[class*='Message_leftSideMessageBubble__'], div[class*='Message_rightSideMessageBubble__']");
    if (bubble) return bubble;
    const bubbleWrapper = wrapper.querySelector("div[class*='Message_messageBubbleWrapper__']");
    if (bubbleWrapper) return bubbleWrapper;
    return wrapper.querySelector("div[class*='Message_messageTextContainer__']") || wrapper;
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

  function wrapperSignature(wrapper) {
    if (!wrapper) return "";
    const id = wrapper.getAttribute ? String(wrapper.getAttribute("id") || "") : "";
    if (id) return id;
    const node = contentNodeFromWrapper(wrapper);
    const raw = node && node.textContent ? String(node.textContent) : "";
    return raw.replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function messageLoadSignature(root) {
    const wrappers = getMessageWrappers(root);
    const total = wrappers.length;
    if (!total) return "0";
    const first = wrappers[0];
    const second = total > 1 ? wrappers[1] : null;
    const last = wrappers[total - 1];
    return [
      total,
      wrapperSignature(first),
      wrapperSignature(second),
      wrapperSignature(last)
    ].join("|");
  }

  function isScrollableElement(el) {
    if (!el) return false;
    const scrollingRoot = document.scrollingElement || document.documentElement || document.body;
    const canScroll = Number(el.scrollHeight || 0) > Number(el.clientHeight || 0) + 20;
    if (el === scrollingRoot || el === document.documentElement || el === document.body) {
      return canScroll;
    }

    let overflowY = "";
    try {
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      overflowY = String((win && win.getComputedStyle ? win.getComputedStyle(el).overflowY : "") || "");
    } catch (_e) {
      overflowY = "";
    }
    const styleScrollable = /(auto|scroll|overlay)/i.test(overflowY);
    return canScroll && (styleScrollable || !overflowY);
  }

  function isScrollCandidate(el) {
    if (!el) return false;
    return Number(el.scrollHeight || 0) > Number(el.clientHeight || 0) + 20;
  }

  function findScrollContainer(root) {
    const scrollingRoot = document.scrollingElement || document.documentElement || document.body;
    const seed = (root && root.querySelector)
      ? (root.querySelector("div[class*='ChatMessagesView_messageTuple__']")
        || root.querySelector("div[class*='ChatMessage_chatMessage__'][id^='message-']")
        || root)
      : root;

    let el = seed;
    for (let depth = 0; depth < 24 && el; depth += 1) {
      if (isScrollableElement(el)) return el;
      el = el.parentElement;
    }

    el = seed;
    for (let depth = 0; depth < 24 && el; depth += 1) {
      if (isScrollCandidate(el)) return el;
      el = el.parentElement;
    }

    if (isScrollableElement(scrollingRoot)) return scrollingRoot;
    return scrollingRoot;
  }

  function getContainerScrollTop(container) {
    if (!container) return 0;
    const scrollingRoot = document.scrollingElement || document.documentElement || document.body;
    if (container === scrollingRoot || container === document.documentElement || container === document.body) {
      const y1 = Number(window.pageYOffset || 0);
      const y2 = document.documentElement ? Number(document.documentElement.scrollTop || 0) : 0;
      const y3 = document.body ? Number(document.body.scrollTop || 0) : 0;
      return Math.max(y1, y2, y3);
    }
    return Number(container.scrollTop || 0);
  }

  function scrollContainerToTop(container) {
    if (!container) return;
    const scrollingRoot = document.scrollingElement || document.documentElement || document.body;
    if (container === scrollingRoot || container === document.documentElement || container === document.body) {
      if (scrollingRoot) scrollingRoot.scrollTop = 0;
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
      return;
    }
    container.scrollTop = 0;
  }

  async function waitForMessageChange(root, previousSig, { waitForLoadMs, pollMs }) {
    const timeoutMs = Math.max(0, Number(waitForLoadMs) || 0);
    const intervalMs = Math.max(10, Number(pollMs) || 80);
    const start = Date.now();

    while ((Date.now() - start) <= timeoutMs) {
      await sleep(intervalMs);
      const nextSig = messageLoadSignature(root);
      if (nextSig !== previousSig) return { changed: true, sig: nextSig };
    }

    return { changed: false, sig: messageLoadSignature(root) };
  }

  async function prepareManualCapture(options) {
    if (!matches({ hostname: location.hostname }) || !isValidConversationUrl()) return false;

    const root = getConversationRoot();
    if (!root) return false;

    const scrollContainer = findScrollContainer(root);
    if (!scrollContainer) return false;

    const maxRounds = Math.max(1, Number(options && options.maxRounds) || 24);
    const settleMs = Math.max(0, Number(options && options.settleMs) || 120);
    const waitForLoadMs = Math.max(80, Number(options && options.waitForLoadMs) || 900);
    const pollMs = Math.max(10, Number(options && options.pollMs) || 80);

    let sig = messageLoadSignature(root);
    let stableAtTopRounds = 0;

    for (let round = 0; round < maxRounds; round += 1) {
      scrollContainerToTop(scrollContainer);
      if (settleMs) await sleep(settleMs);

      const waited = await waitForMessageChange(root, sig, { waitForLoadMs, pollMs });
      sig = waited.sig;

      const atTop = getContainerScrollTop(scrollContainer) <= 2;
      if (waited.changed) {
        stableAtTopRounds = 0;
        continue;
      }

      if (atTop) stableAtTopRounds += 1;
      else stableAtTopRounds = 0;

      if (stableAtTopRounds >= 2) break;
    }

    return true;
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
    const markdown = poeMarkdown();
    const extractImages = typeof utils.extractImageUrlsFromElement === "function" ? utils.extractImageUrlsFromElement : null;
    const appendImageMd = typeof utils.appendImageMarkdown === "function" ? utils.appendImageMarkdown : null;

    const out = [];
    let seq = 0;
    for (const w of wrappers) {
      const role = isUserWrapper(w) ? "user" : (isAssistantWrapper(w) ? "assistant" : "");
      if (!role) continue;

      const node = contentNodeFromWrapper(w);
      const raw = node && (node.innerText || node.textContent) ? (node.innerText || node.textContent) : "";
      const fallbackText = NS.normalize && typeof NS.normalize.normalizeText === "function"
        ? NS.normalize.normalizeText(raw)
        : String(raw || "").trim();

      const contentText = typeof markdown.extractMessageText === "function"
        ? String(markdown.extractMessageText(w, role) || "")
        : fallbackText;

      const imageUrls = extractImages ? extractImages(imageScopeFromWrapper(w)) : [];
      let contentMarkdown = typeof markdown.extractMessageMarkdown === "function"
        ? String(markdown.extractMessageMarkdown(w, role) || "")
        : (contentText || "");
      if (!contentMarkdown) contentMarkdown = contentText || "";

      if (!contentText && !imageUrls.length) continue;
      const nextMarkdown = appendImageMd ? appendImageMd(contentMarkdown, imageUrls) : contentMarkdown;

      out.push({
        messageKey: messageKeyFromWrapper(w, role, contentText, seq),
        role,
        contentText: contentText || "",
        contentMarkdown: nextMarkdown,
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

  const api = { capture, getRoot: getConversationRoot, prepareManualCapture };
  NS.collectors = NS.collectors || {};
  NS.collectors.poe = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "poe", matches, collector: api });
  }

  if (typeof module !== "undefined" && module.exports) {
    const markdown = poeMarkdown();
    module.exports = {
      ...api,
      __test: {
        removeThinkingNodes: markdown.removeThinkingNodes,
        removeNonContentNodes: markdown.removeNonContentNodes,
        normalizeMarkdown: markdown.normalizeMarkdown,
        htmlToMarkdown: markdown.htmlToMarkdown,
        extractTextFromSanitizedClone: markdown.extractTextFromSanitizedClone,
        extractMessageMarkdown: markdown.extractMessageMarkdown,
        extractMessageText: markdown.extractMessageText
      }
    };
  }
})();
