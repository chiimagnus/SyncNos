import type { CollectorDefinition } from '../collector-contract.ts';
import type { CollectorEnv } from '../collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '../collector-utils.ts';
import doubaoMarkdown from './doubao-markdown.ts';

export function createDoubaoCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return /(^|\.)doubao\.com$/.test(hostname);
  }

  function isValidConversationUrl(): any {
    try {
      const p = env.location.pathname || "";
      if (p === "/chat" || p === "/chat/") return false;
      if (/^\/chat\/local/.test(p)) return false;
      return /^\/chat\/(?!local)[^/]+/.test(p);
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return conversationKeyFromLocation(env.location);
  }

  function getConversationRoot(): any {
    return env.document.querySelector("[data-testid='message_list']") || env.document.querySelector("main") || env.document.body;
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  function collectMessages(): any {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const containers: any[] = Array.from(env.document.querySelectorAll("[data-testid='union_message']")) as any[];
    if (!containers.length) return [];

    const out = [];
    let seq = 0;
    for (const c of containers) {
      const sendMessage = c.querySelector("[data-testid='send_message']");
      if (sendMessage) {
        const tEl = sendMessage.querySelector("[data-testid='message_text_content']") || sendMessage;
        const text = env.normalize.normalizeText((tEl as any).innerText || tEl.textContent || "");
        const imageUrls = extractImageUrlsFromElement(sendMessage);
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

      const recv = c.querySelector("[data-testid='receive_message']");
      if (recv) {
        const all: any[] = Array.from(recv.querySelectorAll("[data-testid='message_text_content']")) as any[];
        const textEl = all.find((el: any) => !el.closest("[data-testid='think_block_collapse']")) || recv;
        const fallbackText = env.normalize.normalizeText((textEl as any).innerText || textEl.textContent || "");
        const text = typeof doubaoMarkdown.extractAssistantText === "function"
          ? (doubaoMarkdown.extractAssistantText(textEl) || fallbackText)
          : fallbackText;
        const imageUrls = extractImageUrlsFromElement(recv);
        if (text || imageUrls.length) {
          const contentText = text || "";
          const baseMarkdown = typeof doubaoMarkdown.extractAssistantMarkdown === "function"
            ? (doubaoMarkdown.extractAssistantMarkdown(textEl) || contentText)
            : contentText;
          const contentMarkdown = appendImageMarkdown(baseMarkdown, imageUrls);
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
        source: "doubao",
        conversationKey: findConversationKey(),
        title: env.document.title || "Doubao",
        url: env.location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const collector = { capture, getRoot: getConversationRoot };
  return { id: "doubao", matches, collector };
}
