import type { CollectorDefinition } from '../collector-contract.ts';
import type { CollectorEnv } from '../collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '../collector-utils.ts';
import geminiMarkdown from './gemini-markdown.ts';

export function createGeminiCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return /(^|\.)gemini\.google\.com$/.test(hostname);
  }

  function isValidConversationUrl(): any {
    try {
      const p = env.location.pathname || "";
      if (p === "/app") return false;
      if (/^\/gem\/[^/]+$/.test(p)) return false;
      return /^\/app\/[^/]+$/.test(p) || /^\/gem\/[^/]+\/[^/]+$/.test(p) || /\/app\/[^/]+$/.test(p) || /\/gem\/[^/]+\/[^/]+$/.test(p);
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return conversationKeyFromLocation(env.location);
  }

  function getConversationRoot(): any {
    return env.document.querySelector("#chat-history") || env.document.querySelector("main") || env.document.body;
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  function normalizeTitle(value: any): any {
    const text = value == null ? "" : String(value);
    return env.normalize.normalizeText(text);
  }

  function extractConversationTitle(): any {
    const selectors = [
      "[data-test-id='conversation-title']",
      ".conversation-title-container .conversation-title-column [class*='gds-title']",
      ".conversation-title-container .conversation-title-column"
    ];
    for (const selector of selectors) {
      const el = env.document.querySelector(selector);
      if (!el) continue;
      const title = normalizeTitle((el as any).textContent || (el as any).innerText || "");
      if (title) return title;
    }
    const pageTitle = normalizeTitle(env.document.title || "");
    return pageTitle || "Gemini";
  }

  function extractAssistantMarkdown(node: any, fallbackText: any): any {
    if (typeof geminiMarkdown.extractAssistantMarkdown === "function") {
      const markdown = geminiMarkdown.extractAssistantMarkdown(node);
      if (markdown) return markdown;
    }
    return fallbackText || "";
  }

  function extractAssistantText(node: any): any {
    if (typeof geminiMarkdown.extractAssistantText === "function") {
      const text = geminiMarkdown.extractAssistantText(node);
      if (text) return text;
    }
    const raw = node ? (node.innerText || node.textContent || "") : "";
    return env.normalize.normalizeText(raw);
  }

  function collectMessages(): any {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const blocks: any[] = Array.from(root.querySelectorAll(".conversation-container")) as any[];
    if (!blocks.length) return [];

    const out: any[] = [];
    let seq = 0;
    for (const b of blocks) {
      const user = b.querySelector("user-query .query-text") || b.querySelector("[data-test-id='user-message']") || null;
      if (user) {
        const text = env.normalize.normalizeText(user.innerText || user.textContent || "");
        const imageUrls = extractImageUrlsFromElement(user);
        if (text || imageUrls.length) {
          const contentText = text || "";
          const contentMarkdown = appendImageMarkdown(contentText, imageUrls);
          out.push({
            messageKey: env.normalize.makeFallbackMessageKey({ role: "user", contentText, sequence: seq }),
            role: "user",
            contentText,
            contentMarkdown,
            sequence: seq,
            updatedAt: Date.now()
          });
          seq += 1;
        }
      }

      const model = b.querySelector("model-response") || b.querySelector("model-response .model-response-text") || null;
      if (model) {
        const text = extractAssistantText(model);
        const imageUrls = extractImageUrlsFromElement(model);
        if (text || imageUrls.length) {
          const contentText = text || "";
          const baseMarkdown = extractAssistantMarkdown(model, contentText);
          const contentMarkdown = appendImageMarkdown(baseMarkdown || contentText, imageUrls);
          out.push({
            messageKey: env.normalize.makeFallbackMessageKey({ role: "assistant", contentText, sequence: seq }),
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

  function capture(): any {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const messages = collectMessages();
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: "chat",
        source: "gemini",
        conversationKey: findConversationKey(),
        title: extractConversationTitle(),
        url: env.location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const collector = {
    capture,
    getRoot: getConversationRoot,
    __test: {
      collectMessages,
      extractAssistantMarkdown,
      extractAssistantText
    }
  };

  return { id: "gemini", matches, collector };
}
