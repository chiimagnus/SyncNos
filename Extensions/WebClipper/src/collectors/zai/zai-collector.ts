import collectorContext from '../collector-context.ts';

const NS: any = collectorContext as any;

  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return hostname === "chat.z.ai";
  }

  function findConversationIdFromUrl(): any {
    const m = String(location.pathname || "").match(/^\/c\/([^/?#]+)/);
    return m && m[1] ? m[1] : "";
  }

  function isValidConversationUrl(): any {
    try {
      return !!findConversationIdFromUrl();
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return findConversationIdFromUrl() || (NS.collectorUtils && NS.collectorUtils.conversationKeyFromLocation
      ? NS.collectorUtils.conversationKeyFromLocation(location)
      : "");
  }

  function findTitle(): any {
    return document.title || "z.ai";
  }

  function getConversationRoot(): any {
    return document.querySelector("main") || document.querySelector("[role='main']") || document.body;
  }

  function inEditMode(root: any): any {
    const utils = NS.collectorUtils;
    if (utils && typeof utils.inEditMode === "function") return utils.inEditMode(root);
    return false;
  }

  function sortByDomOrder(nodes: any): any {
    const sorted: any[] = Array.from(nodes || []) as any[];
    sorted.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return sorted;
  }

  function isUserWrapper(wrapper: any): any {
    if (!wrapper) return false;
    if (wrapper.classList && wrapper.classList.contains("user-message")) return true;
    return !!(wrapper.querySelector && wrapper.querySelector(".user-message, .chat-user"));
  }

  function isAssistantWrapper(wrapper: any): any {
    if (!wrapper) return false;
    if (wrapper.classList && wrapper.classList.contains("chat-assistant")) return true;
    return !!(wrapper.querySelector && wrapper.querySelector(".chat-assistant"));
  }

  function zaiMarkdown(): any {
    return NS.zaiMarkdown || {};
  }

  function extractAssistantMarkdown(wrapper: any): any {
    const md = zaiMarkdown();
    if (typeof md.extractAssistantMarkdown === "function") return md.extractAssistantMarkdown(wrapper);
    return "";
  }

  function extractUserText(wrapper: any): any {
    const node = (wrapper && wrapper.querySelector)
      ? (wrapper.querySelector(".whitespace-pre-wrap") || wrapper)
      : wrapper;
    const text = node && ((node as any).innerText || node.textContent) ? ((node as any).innerText || node.textContent) : "";
    return NS.normalize.normalizeText(text);
  }

  function extractAssistantText(wrapper: any): any {
    const md = zaiMarkdown();
    if (typeof md.extractAssistantText === "function") return md.extractAssistantText(wrapper);
    if (!wrapper || !wrapper.querySelector) return "";
    const content = wrapper.querySelector("#response-content-container") || wrapper.querySelector(".chat-assistant") || wrapper;
    const text = content && ((content as any).innerText || content.textContent) ? ((content as any).innerText || content.textContent) : "";
    return NS.normalize.normalizeText(text);
  }

  function getMessageWrappers(root: any): any {
    const scope = root || document;
    const candidates: any[] = Array.from(scope.querySelectorAll("div[id^='message-']")) as any[];
    // Keep only wrappers we can classify; avoid catching nested structural nodes if any.
    const filtered = candidates.filter((w: any) => isUserWrapper(w) || isAssistantWrapper(w));
    return sortByDomOrder(filtered);
  }

  function messageKeyFromWrapper(wrapper: any, role: any, contentText: any, sequence: any): any {
    const id = wrapper && wrapper.getAttribute ? String(wrapper.getAttribute("id") || "") : "";
    if (id) return id;
    return NS.normalize.makeFallbackMessageKey({ role, contentText, sequence });
  }

  function collectMessages({ allowEditing }: any = {}): any {
    const root = getConversationRoot();
    if (!root) return [];
    if (!allowEditing && inEditMode(root)) return [];

    const wrappers = getMessageWrappers(root);
    if (!wrappers.length) return [];

    const out = [];
    const utils = NS.collectorUtils || {};
    const extractImages = typeof utils.extractImageUrlsFromElement === "function" ? utils.extractImageUrlsFromElement : null;
    const appendImageMd = typeof utils.appendImageMarkdown === "function" ? utils.appendImageMarkdown : null;
    let seq = 0;
    for (const w of wrappers) {
      const role = isUserWrapper(w) ? "user" : (isAssistantWrapper(w) ? "assistant" : "");
      if (!role) continue;
      const contentText = role === "user" ? extractUserText(w) : extractAssistantText(w);
      const imageScope = (() => {
        if (!w || !w.querySelector) return w;
        if (role === "user") return w.querySelector(".whitespace-pre-wrap") || w.querySelector(".chat-user") || w;
        return w.querySelector("#response-content-container") || w.querySelector(".markdown-prose") || w.querySelector(".chat-assistant") || w;
      })();
      const imageUrls = extractImages ? extractImages(imageScope || w) : [];
      if (!contentText && !imageUrls.length) continue;
      const contentMarkdown = role === "assistant"
        ? (extractAssistantMarkdown(w) || contentText)
        : contentText;
      const nextMarkdown = appendImageMd ? appendImageMd(contentMarkdown || contentText || "", imageUrls) : (contentMarkdown || contentText || "");
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

  function capture(options: any): any {
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

  const api: any = { capture, getRoot: getConversationRoot };
  const md = zaiMarkdown();
  api.__test = {
    removeThinkingNodes: md.removeThinkingNodes,
    removeNonContentNodes: md.removeNonContentNodes,
    normalizeMarkdown: md.normalizeMarkdown,
    htmlToMarkdown: md.htmlToMarkdown,
    extractTextFromSanitizedClone: md.extractTextFromSanitizedClone,
    extractAssistantMarkdown: md.extractAssistantMarkdown,
    extractAssistantText: md.extractAssistantText,
  };
  NS.collectors = NS.collectors || {};
  NS.collectors.zai = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "zai", matches, collector: api });
  }
