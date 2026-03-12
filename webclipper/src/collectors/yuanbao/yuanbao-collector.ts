import type { CollectorDefinition } from '../collector-contract.ts';
import type { CollectorEnv } from '../collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '../collector-utils.ts';
import yuanbaoMarkdown from './yuanbao-markdown.ts';

export function createYuanbaoCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return hostname === "yuanbao.tencent.com";
  }

  function isValidConversationUrl(): any {
    try {
      return /^\/chat\/[^/]+\/[^/]+$/.test(env.location.pathname || "");
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return conversationKeyFromLocation(env.location);
  }

  function getConversationRoot(): any {
    return env.document.querySelector(".agent-chat__list__content") || env.document.querySelector("main") || env.document.body;
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  function collectMessages(): any {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const nodes: any[] = [];
    root.querySelectorAll(".agent-chat__list__item--human").forEach((el: any) => nodes.push({ el, role: "user" }));
    root.querySelectorAll(".agent-chat__list__item--ai").forEach((el: any) => nodes.push({ el, role: "assistant" }));
    if (!nodes.length) return [];

    nodes.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      const DOCUMENT_POSITION_FOLLOWING = env.window?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;
      const DOCUMENT_POSITION_PRECEDING = env.window?.Node?.DOCUMENT_POSITION_PRECEDING ?? 2;
      if (pos & DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const out: any[] = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const { el, role } = nodes[i];
      let tEl = el;
      if (role === "user") {
        tEl = el.querySelector(".hyc-content-text") || el;
      } else {
        tEl = el.querySelector(".agent-chat__speech-text") || el.querySelector(".hyc-component-reasoner__text") || el;
      }
      const fallbackText = env.normalize.normalizeText((tEl as any).innerText || tEl.textContent || "");
      const text = role === "assistant" && typeof yuanbaoMarkdown.extractAssistantText === "function"
        ? (yuanbaoMarkdown.extractAssistantText(tEl) || fallbackText)
        : fallbackText;
      const imageRoot = el.querySelector?.(".agent-chat__bubble") || el;
      const imageUrls = extractImageUrlsFromElement(imageRoot);
      if (!text && !imageUrls.length) continue;
      const contentText = text || "";
      const baseMarkdown = role === "assistant" && typeof yuanbaoMarkdown.extractAssistantMarkdown === "function"
        ? (yuanbaoMarkdown.extractAssistantMarkdown(tEl) || contentText)
        : contentText;
      const contentMarkdown = appendImageMarkdown(baseMarkdown, imageUrls);
      out.push({
        messageKey: env.normalize.makeFallbackMessageKey({ role, contentText, sequence: i }),
        role,
        contentText,
        contentMarkdown,
        sequence: i,
        updatedAt: Date.now()
      });
    }
    return out;
  }

  function capture(): any {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const messages = collectMessages();
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: "chat",
        source: "yuanbao",
        conversationKey: findConversationKey(),
        title: env.document.title || "Yuanbao",
        url: env.location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const collector = { capture, getRoot: getConversationRoot };
  return { id: "yuanbao", matches, collector };
}
