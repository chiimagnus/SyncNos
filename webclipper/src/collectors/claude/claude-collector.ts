import type { CollectorDefinition } from '../collector-contract.ts';
import type { CollectorEnv } from '../collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '../collector-utils.ts';
import { replaceMathElementsWithLatexText } from '../formula-utils.ts';

export function createClaudeCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return /(^|\.)claude\.ai$/.test(hostname);
  }

  function isValidConversationUrl(): any {
    try {
      return /^\/chat\/.+/.test(env.location.pathname);
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return conversationKeyFromLocation(env.location);
  }

  function getConversationRoot(): any {
    return env.document.querySelector("main") || env.document.querySelector("[role='main']") || env.document.body;
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  function isThinkingBlock(el: any): any {
    if (!el || !el.querySelector) return false;
    // Heuristic: collapsible containers usually have aria-expanded button.
    if (el.querySelector("button[aria-expanded]")) return true;
    const cls = el.classList;
    if (cls && cls.contains("transition-all") && cls.contains("rounded-lg") && (cls.contains("border") || cls.contains("border-0.5"))) return true;
    return false;
  }

  function extractOnlyFormalResponse(container: any): any {
    if (!container) return "";
    const parts: any[] = [];
    const children: any[] = Array.from(container.children || []) as any[];
    if (!children.length) {
      return env.normalize.normalizeText(extractTextWithMath(container));
    }
    for (const child of children) {
      if (isThinkingBlock(child)) continue;
      const t = env.normalize.normalizeText(extractTextWithMath(child));
      if (t) parts.push(t);
    }
    return env.normalize.normalizeText(parts.join("\n\n"));
  }

  function extractTextWithMath(node: any): any {
    if (!node) return "";
    const hasQuery = !!(node && typeof node.querySelector === "function");
    const hasClone = !!(node && typeof node.cloneNode === "function");
    let hasMath = false;
    if (hasQuery) {
      try {
        hasMath = !!node.querySelector(".math-block[data-math], .katex, .katex-display, mjx-container, script[type^='math/tex'], .ybc-markdown-katex");
      } catch (_e) {
        hasMath = false;
      }
    }
    if (!hasMath || !hasClone) return node.innerText || node.textContent || "";
    try {
      const cloned = node.cloneNode(true);
      replaceMathElementsWithLatexText(cloned);
      return cloned.innerText || cloned.textContent || "";
    } catch (_e) {
      return node.innerText || node.textContent || "";
    }
  }

  function collectMessages(): any {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const containers: any[] = Array.from(root.querySelectorAll("[data-test-render-count]")) as any[];
    if (!containers.length) return [];

    const out: any[] = [];
    let seq = 0;
    for (const c of containers) {
      const user = c.querySelector("[data-testid='user-message']");
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

      const ai = c.querySelector(".font-claude-response") || c.querySelector("[data-testid='assistant-message']") || null;
      if (ai) {
        const text = extractOnlyFormalResponse(ai);
        const imageUrls = extractImageUrlsFromElement(ai);
        if (text || imageUrls.length) {
          const contentText = text || "";
          const contentMarkdown = appendImageMarkdown(contentText, imageUrls);
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
        source: "claude",
        conversationKey: findConversationKey(),
        title: env.document.title || "Claude",
        url: env.location.href,
        warningFlags: [],
        lastCapturedAt: Date.now()
      },
      messages
    };
  }

  const collector = { capture, getRoot: getConversationRoot };
  return { id: "claude", matches, collector };
}
