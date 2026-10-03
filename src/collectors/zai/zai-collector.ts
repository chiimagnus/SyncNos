import type { CollectorDefinition } from '@collectors/collector-contract.ts';
import type { CollectorEnv } from '@collectors/collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '@collectors/collector-utils.ts';
import zaiMarkdown from '@collectors/zai/zai-markdown.ts';

export function createZaiCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return hostname === 'chat.z.ai';
  }

  function findConversationIdFromUrl(): any {
    const m = String(env.location.pathname || '').match(/^\/c\/([^/?#]+)/);
    return m && m[1] ? m[1] : '';
  }

  function isValidConversationUrl(): any {
    try {
      return !!findConversationIdFromUrl();
    } catch (_e) {
      return false;
    }
  }

  function isConversationSurfaceUrl(): boolean {
    try {
      const p = env.location.pathname || '';
      return p === '/' || /^\/c(?:\/|$)/.test(p);
    } catch (_error) {
      return false;
    }
  }

  function findConversationKey(): any {
    return findConversationIdFromUrl() || conversationKeyFromLocation(env.location);
  }

  function findTitle(): any {
    return env.document.title || 'z.ai';
  }

  function getConversationRoot(): any {
    return env.document.querySelector('main') || env.document.querySelector("[role='main']") || env.document.body;
  }

  function inEditMode(root: any): any {
    if (root?.querySelector?.("[id^='message-edit-']")) return true;
    return inEditModeUtil(root);
  }

  function isConversationStreaming(): boolean {
    return !!env.document.getElementById('chat-input') && !env.document.getElementById('send-message-button');
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
    if (wrapper.classList && wrapper.classList.contains('user-message')) return true;
    return !!(wrapper.querySelector && wrapper.querySelector('.user-message, .chat-user'));
  }

  function isAssistantWrapper(wrapper: any): any {
    if (!wrapper) return false;
    if (wrapper.classList && wrapper.classList.contains('chat-assistant')) return true;
    return !!(wrapper.querySelector && wrapper.querySelector('.chat-assistant'));
  }

  function extractAssistantMarkdown(wrapper: any): any {
    if (typeof zaiMarkdown.extractAssistantMarkdown === 'function')
      return zaiMarkdown.extractAssistantMarkdown(wrapper);
    return '';
  }

  function extractUserText(wrapper: any): any {
    const node = wrapper && wrapper.querySelector ? wrapper.querySelector('.whitespace-pre-wrap') || wrapper : wrapper;
    const text =
      node && ((node as any).innerText || node.textContent) ? (node as any).innerText || node.textContent : '';
    return env.normalize.normalizeText(text);
  }

  function extractAssistantText(wrapper: any): any {
    if (typeof zaiMarkdown.extractAssistantText === 'function') return zaiMarkdown.extractAssistantText(wrapper);
    if (!wrapper || !wrapper.querySelector) return '';
    const content =
      wrapper.querySelector('#response-content-container') || wrapper.querySelector('.chat-assistant') || wrapper;
    const text =
      content && ((content as any).innerText || content.textContent)
        ? (content as any).innerText || content.textContent
        : '';
    return env.normalize.normalizeText(text);
  }

  function comesBefore(left: Element, right: Element): boolean {
    const position = left.compareDocumentPosition(right);
    const following = env.window?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;
    return !!(position & following);
  }

  function attachmentRegionForUser(wrapper: Element): Element | null {
    const textNode = wrapper.querySelector('.whitespace-pre-wrap');
    const candidates = Array.from(wrapper.querySelectorAll('.overflow-x-auto')).filter(
      (element) => !!element.querySelector("button[type='button'], video[src]"),
    );
    if (!candidates.length) return null;
    if (!textNode) return candidates[0] || null;
    return candidates.find((element) => comesBefore(element, textNode)) || null;
  }

  function attachmentNameFromButton(button: Element): string {
    const preferred = button.querySelector('.text-text-primary.truncate');
    const fallback = Array.from(button.querySelectorAll("[class*='truncate']")).find((element) => {
      if (element.querySelector("[class*='truncate']")) return false;
      return !!env.normalize.normalizeText(String(element.textContent || '')).trim();
    });
    return env.normalize.normalizeText(String((preferred || fallback)?.textContent || '')).trim();
  }

  function userAttachmentContent(wrapper: Element): { text: string; markdown: string; fingerprint: string } {
    const region = attachmentRegionForUser(wrapper);
    if (!region) return { text: '', markdown: '', fingerprint: '' };

    const textParts: string[] = [];
    const markdownParts: string[] = [];
    const fingerprints: string[] = [];
    const seen = new Set<string>();

    for (const button of Array.from(region.querySelectorAll("button[type='button']"))) {
      const name = attachmentNameFromButton(button);
      if (!name) continue;
      const key = `file:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = `Attachment: ${name}`;
      textParts.push(label);
      markdownParts.push(label);
      fingerprints.push(`file\u001e${name}`);
    }

    for (const video of Array.from(region.querySelectorAll('video[src]'))) {
      const src = String(video.getAttribute('src') || '').trim();
      const key = `video:${src || 'unknown'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = 'Video attachment';
      textParts.push(src ? `${label}: ${src}` : label);
      markdownParts.push(/^https?:\/\//i.test(src) ? `[${label}](${src})` : label);
      fingerprints.push(`video\u001e${src}`);
    }

    return {
      text: textParts.join('\n\n'),
      markdown: markdownParts.join('\n\n'),
      fingerprint: fingerprints.join('\u001f'),
    };
  }

  function getMessageWrappers(root: any): any {
    const scope = root || env.document;
    const candidates: any[] = Array.from(scope.querySelectorAll("div[id^='message-']")) as any[];
    // Keep only wrappers we can classify; avoid catching nested structural nodes if any.
    const filtered = candidates.filter((w: any) => isUserWrapper(w) || isAssistantWrapper(w));
    return sortByDomOrder(filtered);
  }

  function messageKeyFromWrapper(wrapper: any, role: any, contentText: any, sequence: any): any {
    const id = wrapper && wrapper.getAttribute ? String(wrapper.getAttribute('id') || '') : '';
    if (id) return id;
    return env.normalize.makeFallbackMessageKey({ role, text: contentText, sequence });
  }

  function collectMessages(): any {
    const root = getConversationRoot();
    if (!root || inEditMode(root)) return [];

    const wrappers = getMessageWrappers(root);
    if (!wrappers.length) return [];

    const out = [];
    let seq = 0;
    const streaming = isConversationStreaming();
    const lastWrapper = wrappers.at(-1) || null;
    for (const w of wrappers) {
      const role = isUserWrapper(w) ? 'user' : isAssistantWrapper(w) ? 'assistant' : '';
      if (!role) continue;
      if (streaming && role === 'assistant' && w === lastWrapper) continue;
      const attachment = role === 'user' ? userAttachmentContent(w) : { text: '', markdown: '', fingerprint: '' };
      const baseText = role === 'user' ? extractUserText(w) : extractAssistantText(w);
      const contentText = [attachment.text, baseText].filter(Boolean).join('\n\n');
      const imageScope = (() => {
        if (!w || !w.querySelector) return w;
        if (role === 'user') {
          // User-uploaded images live in a "not-prose" attachment card above the text bubble.
          // Keep the scope at `.chat-user`/wrapper so we don't miss those `<img>` nodes.
          return w.querySelector('.chat-user') || w;
        }
        return (
          w.querySelector('#response-content-container') ||
          w.querySelector('.markdown-prose') ||
          w.querySelector('.chat-assistant') ||
          w
        );
      })();
      const imageUrls = extractImageUrlsFromElement(imageScope || w);
      if (!contentText && !imageUrls.length) continue;
      const baseMarkdown = role === 'assistant' ? extractAssistantMarkdown(w) || baseText : baseText;
      const contentMarkdown = [attachment.markdown, baseMarkdown].filter(Boolean).join('\n\n');
      const nextMarkdown = appendImageMarkdown(contentMarkdown || contentText || '', imageUrls);
      out.push({
        messageKey: messageKeyFromWrapper(w, role, contentText, seq),
        role,
        contentMarkdown: nextMarkdown,
        sequence: seq,
        updatedAt: Date.now(),
      });
      seq += 1;
    }
    return out;
  }

  function capture(options: any): any {
    if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
    const messages = collectMessages();
    if (!messages.length) return null;
    return {
      conversation: {
        sourceType: 'chat',
        source: 'zai',
        conversationKey: findConversationKey(),
        title: findTitle(),
        url: env.location.href,
        warningFlags: [],
      },
      messages,
    };
  }

  const collector: any = {
    capture,
    isCaptureAvailable: isConversationSurfaceUrl,
    getRoot: getConversationRoot,
  };
  collector.__test = {
    removeThinkingNodes: (zaiMarkdown as any).removeThinkingNodes,
    removeNonContentNodes: (zaiMarkdown as any).removeNonContentNodes,
    normalizeMarkdown: (zaiMarkdown as any).normalizeMarkdown,
    htmlToMarkdown: (zaiMarkdown as any).htmlToMarkdown,
    extractTextFromSanitizedClone: (zaiMarkdown as any).extractTextFromSanitizedClone,
    extractAssistantMarkdown: (zaiMarkdown as any).extractAssistantMarkdown,
    extractAssistantText: (zaiMarkdown as any).extractAssistantText,
  };

  return { id: 'zai', matches, collector };
}
