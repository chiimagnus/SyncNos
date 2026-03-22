import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '@collectors/collector-utils.ts';
import kimiMarkdown from '@collectors/kimi/kimi-markdown.ts';

export function createKimiCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return hostname === 'kimi.moonshot.cn' || /(^|\.)kimi\.com$/.test(hostname);
  }

  function isValidConversationUrl(): any {
    try {
      return /^\/chat\/[^/]+/.test(env.location.pathname || '');
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return conversationKeyFromLocation(env.location);
  }

  function getConversationRoot(): any {
    return env.document.querySelector('.chat-content') || env.document.querySelector('main') || env.document.body;
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  function collectMessages(): any {
    const root = getConversationRoot();
    if (!root) return [];
    if (inEditMode(root)) return [];

    const items: any[] = Array.from(root.querySelectorAll('.chat-content-item')) as any[];
    if (!items.length) return [];

    const out: any[] = [];
    function mergeImageUrls(nodes: any): any {
      const set = new Set();
      for (const n of nodes || []) {
        const urls = extractImageUrlsFromElement(n);
        for (const u of urls || []) set.add(u);
      }
      return Array.from(set);
    }

    let seq = 0;
    for (const item of items) {
      const isUser = item.classList && item.classList.contains('chat-content-item-user');
      const isAssistant = item.classList && item.classList.contains('chat-content-item-assistant');
      if (!isUser && !isAssistant) continue;
      const role = isUser ? 'user' : 'assistant';

      let text = '';
      let imageScopes: any[] = [item];
      const attachmentRoots: any[] = [];
      item.querySelectorAll?.('.attachment-list, .attachment-list-image, .attachment-list-file').forEach((el: any) => {
        attachmentRoots.push(el);
      });
      if (isUser) {
        const partsEls: any[] = Array.from(item.querySelectorAll('.user-content')) as any[];
        const parts = partsEls
          .map((el: any) => env.normalize.normalizeText(el.innerText || el.textContent || ''))
          .filter(Boolean);
        text = env.normalize.normalizeText(parts.join('\n\n'));
        // User-uploaded images are rendered in the attachment list, not inside `.user-content`.
        // Include attachment roots to avoid missing images.
        imageScopes = [...partsEls, ...attachmentRoots].filter(Boolean);
        if (!imageScopes.length) imageScopes = [item];
      } else {
        const candidates: any[] = [];
        item.querySelectorAll('.markdown-container, .editor-content').forEach((el: any) => {
          if (el.closest('.think-stage')) return;
          candidates.push(el);
        });
        candidates.sort((a: any, b: any) => {
          const pos = a.compareDocumentPosition(b);
          const DOCUMENT_POSITION_FOLLOWING = env.window?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;
          const DOCUMENT_POSITION_PRECEDING = env.window?.Node?.DOCUMENT_POSITION_PRECEDING ?? 2;
          if (pos & DOCUMENT_POSITION_FOLLOWING) return -1;
          if (pos & DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });
        const uniq: any[] = [];
        for (const candidate of candidates) {
          if (uniq.some((p: any) => p.contains(candidate))) continue;
          uniq.push(candidate);
        }

        const textParts = uniq
          .map((el: any) => {
            const fallbackText = env.normalize.normalizeText(el.innerText || el.textContent || '');
            if (typeof kimiMarkdown.extractAssistantText !== 'function') return fallbackText;
            return kimiMarkdown.extractAssistantText(el) || fallbackText;
          })
          .filter(Boolean);
        text = env.normalize.normalizeText(textParts.join('\n\n'));

        const markdownParts = uniq
          .map((el: any) => {
            const fallbackText = env.normalize.normalizeText(el.innerText || el.textContent || '');
            if (typeof kimiMarkdown.extractAssistantMarkdown !== 'function') return fallbackText;
            return kimiMarkdown.extractAssistantMarkdown(el) || fallbackText;
          })
          .filter(Boolean);
        const joinedMarkdown = markdownParts.join('\n\n');
        item.__kimiContentMarkdown =
          typeof kimiMarkdown.normalizeMarkdown === 'function'
            ? kimiMarkdown.normalizeMarkdown(joinedMarkdown)
            : joinedMarkdown;

        imageScopes = [...(uniq.length ? uniq : [item]), ...attachmentRoots].filter(Boolean);
      }

      const imageUrls = mergeImageUrls(imageScopes);
      if (!text && !imageUrls.length) continue;
      const contentText = text || '';
      const baseMarkdown = !isUser ? item.__kimiContentMarkdown || contentText : contentText;
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
        source: 'kimi',
        conversationKey: findConversationKey(),
        title: env.document.title || 'Kimi',
        url: env.location.href,
        warningFlags: [],
        lastCapturedAt: Date.now(),
      },
      messages,
    };
  }

  const collector = { capture, getRoot: getConversationRoot };
  return { id: 'kimi', matches, collector };
}
