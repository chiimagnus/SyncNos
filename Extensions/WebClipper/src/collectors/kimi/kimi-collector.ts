import collectorContext from '../collector-context.ts';

const NS: any = collectorContext as any;

  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
    return hostname === "kimi.moonshot.cn" || /(^|\.)kimi\.com$/.test(hostname);
  }

  function isValidConversationUrl(): any {
    try {
      return /^\/chat\/[^/]+/.test(location.pathname || "");
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return NS.collectorUtils.conversationKeyFromLocation(location);
  }

  function getConversationRoot(): any {
    return document.querySelector(".chat-content") || document.querySelector("main") || document.body;
  }

  function inEditMode(root: any): any {
    return NS.collectorUtils.inEditMode(root);
  }

  function kimiMarkdown(): any {
    return NS.kimiMarkdown || {};
  }

  function collectMessages(): any {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const items: any[] = Array.from(root.querySelectorAll(".chat-content-item")) as any[];
    if (!items.length) return [];

    const out: any[] = [];
    const utils = NS.collectorUtils || {};
    const markdown = kimiMarkdown();
    const extractImages = typeof utils.extractImageUrlsFromElement === "function" ? utils.extractImageUrlsFromElement : null;
    const appendImageMd = typeof utils.appendImageMarkdown === "function" ? utils.appendImageMarkdown : null;

    function mergeImageUrls(nodes: any): any {
      if (!extractImages) return [];
      const set = new Set();
      for (const n of nodes || []) {
        const urls = extractImages(n);
        for (const u of urls || []) set.add(u);
      }
      return Array.from(set);
    }

    let seq = 0;
    for (const item of items) {
      const isUser = item.classList && item.classList.contains("chat-content-item-user");
      const isAssistant = item.classList && item.classList.contains("chat-content-item-assistant");
      if (!isUser && !isAssistant) continue;
      const role = isUser ? "user" : "assistant";

      let text = "";
      let imageScopes: any[] = [item];
      if (isUser) {
        const partsEls: any[] = Array.from(item.querySelectorAll(".user-content")) as any[];
        const parts = partsEls.map((el: any) => NS.normalize.normalizeText(el.innerText || el.textContent || "")).filter(Boolean);
        text = NS.normalize.normalizeText(parts.join("\n\n"));
        imageScopes = partsEls.length ? partsEls : [item];
      } else {
        const candidates: any[] = [];
        item.querySelectorAll(".markdown-container, .editor-content").forEach((el: any) => {
          if (el.closest(".think-stage")) return;
          candidates.push(el);
        });
        candidates.sort((a: any, b: any) => {
          const pos = a.compareDocumentPosition(b);
          if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });
        const uniq: any[] = [];
        for (const candidate of candidates) {
          if (uniq.some((p: any) => p.contains(candidate))) continue;
          uniq.push(candidate);
        }

        const textParts = uniq.map((el: any) => {
          const fallbackText = NS.normalize.normalizeText(el.innerText || el.textContent || "");
          if (typeof markdown.extractAssistantText !== "function") return fallbackText;
          return markdown.extractAssistantText(el) || fallbackText;
        }).filter(Boolean);
        text = NS.normalize.normalizeText(textParts.join("\n\n"));

        const markdownParts = uniq.map((el: any) => {
          const fallbackText = NS.normalize.normalizeText(el.innerText || el.textContent || "");
          if (typeof markdown.extractAssistantMarkdown !== "function") return fallbackText;
          return markdown.extractAssistantMarkdown(el) || fallbackText;
        }).filter(Boolean);
        const joinedMarkdown = markdownParts.join("\n\n");
        item.__kimiContentMarkdown = typeof markdown.normalizeMarkdown === "function"
          ? markdown.normalizeMarkdown(joinedMarkdown)
          : joinedMarkdown;

        imageScopes = uniq.length ? uniq : [item];
      }

      const imageUrls = mergeImageUrls(imageScopes);
      if (!text && !imageUrls.length) continue;
      const contentText = text || "";
      const baseMarkdown = !isUser
        ? (item.__kimiContentMarkdown || contentText)
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

  function capture(): any {
    if (!matches({ hostname: location.hostname }) || !isValidConversationUrl()) return null;
    const messages = collectMessages();
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: "chat",
        source: "kimi",
        conversationKey: findConversationKey(),
        title: document.title || "Kimi",
        url: location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const api = { capture, getRoot: getConversationRoot };
  NS.collectors = NS.collectors || {};
  NS.collectors.kimi = api;
  if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
    NS.collectorsRegistry.register({ id: "kimi", matches, collector: api });
  }
