import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '@collectors/collector-utils.ts';
import deepseekMarkdown from '@collectors/deepseek/deepseek-markdown.ts';

export function createDeepseekCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return hostname === 'chat.deepseek.com';
  }

  function isValidConversationUrl(): any {
    try {
      return /^\/a\/chat\/s\/[^/]+$/.test(env.location.pathname || '');
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return conversationKeyFromLocation(env.location);
  }

  function getConversationRoot(): any {
    return env.document.querySelector('.dad65929') || env.document.querySelector('main') || env.document.body;
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  function collectMessages(): any {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const nodes: any[] = Array.from(root.querySelectorAll('._9663006, ._4f9bf79._43c05b5')) as any[];
    if (!nodes.length) return [];

    const out: any[] = [];
    let seq = 0;
    for (const el of nodes) {
      const isUser = el.classList && el.classList.contains('_9663006');
      const role = isUser ? 'user' : 'assistant';
      let text = '';
      let contentNode = el;
      if (isUser) {
        const u = el.querySelector('.fbb737a4') || el;
        contentNode = u;
        text = env.normalize.normalizeText(u.innerText || u.textContent || '');
      } else {
        const ds = el.querySelector('.ds-message') || el;
        // Prefer direct markdown child for formal response; avoid think blocks.
        const directMarkdown = Array.from(ds.children || []).find(
          (c: any) => c && c.classList && c.classList.contains('ds-markdown'),
        );
        const contentEl = directMarkdown || ds.querySelector('.ds-markdown') || ds;
        contentNode = contentEl;
        const fallbackText = env.normalize.normalizeText(contentEl.innerText || contentEl.textContent || '');
        text =
          typeof deepseekMarkdown.extractAssistantText === 'function'
            ? deepseekMarkdown.extractAssistantText(contentEl) || fallbackText
            : fallbackText;
      }
      const imageUrls = extractImageUrlsFromElement(contentNode || el);
      if (!text && !imageUrls.length) continue;
      const contentText = text || '';
      const baseMarkdown =
        !isUser && typeof deepseekMarkdown.extractAssistantMarkdown === 'function'
          ? deepseekMarkdown.extractAssistantMarkdown(contentNode) || contentText
          : contentText;
      const contentMarkdown = appendImageMarkdown(baseMarkdown, imageUrls);
      out.push({
        messageKey: env.normalize.makeFallbackMessageKey({ role, contentText, sequence: seq }),
        role,
        contentText,
        contentMarkdown,
        sequence: seq,
        updatedAt: Date.now(),
      });
      seq += 1;
    }
    return out;
  }

  function capture(): any {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const messages = collectMessages();
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: 'chat',
        source: 'deepseek',
        conversationKey: findConversationKey(),
        title: env.document.title || 'DeepSeek',
        url: env.location.href,
        warningFlags: [],
        lastCapturedAt: Date.now(),
      },
      messages,
    };
  }

  const collector = { capture, getRoot: getConversationRoot };
  return { id: 'deepseek', matches, collector };
}
