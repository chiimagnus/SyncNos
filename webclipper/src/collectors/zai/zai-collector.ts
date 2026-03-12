import type { CollectorDefinition } from '../collector-contract.ts';
import type { CollectorEnv } from '../collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '../collector-utils.ts';
import zaiMarkdown from './zai-markdown.ts';

export function createZaiCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return hostname === "chat.z.ai";
  }

  function findConversationIdFromUrl(): any {
    const m = String(env.location.pathname || "").match(/^\/c\/([^/?#]+)/);
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
    return findConversationIdFromUrl() || conversationKeyFromLocation(env.location);
  }

  function findTitle(): any {
    return env.document.title || "z.ai";
  }

  function getConversationRoot(): any {
    return env.document.querySelector("main") || env.document.querySelector("[role='main']") || env.document.body;
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  function sortByDomOrder(nodes: any): any {
    const sorted: any[] = Array.from(nodes || []) as any[];
    sorted.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      const DOCUMENT_POSITION_FOLLOWING = env.window?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;
      const DOCUMENT_POSITION_PRECEDING = env.window?.Node?.DOCUMENT_POSITION_PRECEDING ?? 2;
      if (pos & DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & DOCUMENT_POSITION_PRECEDING) return 1;
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

  function extractAssistantMarkdown(wrapper: any): any {
    if (typeof zaiMarkdown.extractAssistantMarkdown === "function") return zaiMarkdown.extractAssistantMarkdown(wrapper);
    return "";
  }

  function extractUserText(wrapper: any): any {
    const node = (wrapper && wrapper.querySelector)
      ? (wrapper.querySelector(".whitespace-pre-wrap") || wrapper)
      : wrapper;
    const text = node && ((node as any).innerText || node.textContent) ? ((node as any).innerText || node.textContent) : "";
    return env.normalize.normalizeText(text);
  }

  function extractAssistantText(wrapper: any): any {
    if (typeof zaiMarkdown.extractAssistantText === "function") return zaiMarkdown.extractAssistantText(wrapper);
    if (!wrapper || !wrapper.querySelector) return "";
    const content = wrapper.querySelector("#response-content-container") || wrapper.querySelector(".chat-assistant") || wrapper;
    const text = content && ((content as any).innerText || content.textContent) ? ((content as any).innerText || content.textContent) : "";
    return env.normalize.normalizeText(text);
  }

  function getMessageWrappers(root: any): any {
    const scope = root || env.document;
    const candidates: any[] = Array.from(scope.querySelectorAll("div[id^='message-']")) as any[];
    // Keep only wrappers we can classify; avoid catching nested structural nodes if any.
    const filtered = candidates.filter((w: any) => isUserWrapper(w) || isAssistantWrapper(w));
    return sortByDomOrder(filtered);
  }

  function messageKeyFromWrapper(wrapper: any, role: any, contentText: any, sequence: any): any {
    const id = wrapper && wrapper.getAttribute ? String(wrapper.getAttribute("id") || "") : "";
    if (id) return id;
    return env.normalize.makeFallbackMessageKey({ role, contentText, sequence });
  }

  function collectMessages({ allowEditing }: any = {}): any {
    const root = getConversationRoot();
    if (!root) return [];
    if (!allowEditing && inEditMode(root)) return [];

    const wrappers = getMessageWrappers(root);
    if (!wrappers.length) return [];

    const out = [];
    let seq = 0;
    for (const w of wrappers) {
      const role = isUserWrapper(w) ? "user" : (isAssistantWrapper(w) ? "assistant" : "");
      if (!role) continue;
      const contentText = role === "user" ? extractUserText(w) : extractAssistantText(w);
      const imageScope = (() => {
        if (!w || !w.querySelector) return w;
        if (role === "user") {
          // User-uploaded images live in a "not-prose" attachment card above the text bubble.
          // Keep the scope at `.chat-user`/wrapper so we don't miss those `<img>` nodes.
          return w.querySelector(".chat-user") || w;
        }
        return w.querySelector("#response-content-container") || w.querySelector(".markdown-prose") || w.querySelector(".chat-assistant") || w;
      })();
      const imageUrls = extractImageUrlsFromElement(imageScope || w);
      if (!contentText && !imageUrls.length) continue;
      const contentMarkdown = role === "assistant"
        ? (extractAssistantMarkdown(w) || contentText)
        : contentText;
      const nextMarkdown = appendImageMarkdown(contentMarkdown || contentText || "", imageUrls);
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
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const messages = collectMessages({ allowEditing: !!(options && options.manual) });
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: "chat",
        source: "zai",
        conversationKey: findConversationKey(),
        title: findTitle(),
        url: env.location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const collector: any = { capture, getRoot: getConversationRoot };
  collector.__test = {
    removeThinkingNodes: (zaiMarkdown as any).removeThinkingNodes,
    removeNonContentNodes: (zaiMarkdown as any).removeNonContentNodes,
    normalizeMarkdown: (zaiMarkdown as any).normalizeMarkdown,
    htmlToMarkdown: (zaiMarkdown as any).htmlToMarkdown,
    extractTextFromSanitizedClone: (zaiMarkdown as any).extractTextFromSanitizedClone,
    extractAssistantMarkdown: (zaiMarkdown as any).extractAssistantMarkdown,
    extractAssistantText: (zaiMarkdown as any).extractAssistantText,
  };

  return { id: "zai", matches, collector };
}
