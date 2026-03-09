import type { CollectorDefinition } from '../collector-contract.ts';
import type { CollectorEnv } from '../collector-env.ts';
import { appendImageMarkdown, extractImageUrlsFromElement } from '../collector-utils.ts';
import chatgptMarkdown from './chatgpt-markdown.ts';

export function createChatgptCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return /(^|\.)chatgpt\.com$/.test(hostname) || /(^|\.)chat\.openai\.com$/.test(hostname);
  }

  function findConversationIdFromUrl(): any {
    const m =
      env.location.pathname.match(/^\/c\/([^/?#]+)/) || env.location.pathname.match(/^\/g\/[^/]+\/c\/([^/?#]+)/);
    return m && m[1] ? m[1] : '';
  }

  function makeFallbackConversationKey(messages: any): any {
    const firstUser = Array.isArray(messages) ? messages.find((m: any) => m && m.role === 'user' && m.contentText) : null;
    const seed = `${env.location.hostname}|${env.location.pathname}|${firstUser ? firstUser.contentText : ''}`;
    const hash = env.normalize && env.normalize.fnv1a32 ? env.normalize.fnv1a32(seed) : String(Date.now());
    return `fallback_${hash}`;
  }

  function findTitle(): any {
    const h = env.document.querySelector('h1');
    const t = h && h.textContent ? h.textContent.trim() : '';
    return t || env.document.title || 'ChatGPT';
  }

  function getConversationRoot(): any {
    return env.document.querySelector('main') || env.document.querySelector("[role='main']") || env.document.body;
  }

  function inEditMode(root: any): any {
    if (!root) return false;
    const ta = root.querySelector('textarea');
    if (!ta) return false;
    return env.document.activeElement === ta || ta.contains(env.document.activeElement);
  }

  function userContentNode(element: any): any {
    return element.querySelector('.whitespace-pre-wrap') || element;
  }

  function assistantContentNode(element: any): any {
    return element.querySelector('.markdown.prose') || element.querySelector('.markdown') || element;
  }

  function getTurnWrappers(root: any): any {
    const scope = root || env.document;
    const uniqueNodes = new Set();

    scope.querySelectorAll("div[data-testid='conversation-turn']").forEach((el: any) => uniqueNodes.add(el));
    scope.querySelectorAll('[data-message-author-role]').forEach((el: any) => uniqueNodes.add(el));
    scope.querySelectorAll('.agent-turn').forEach((el: any) => uniqueNodes.add(el));

    const sorted: any[] = Array.from(uniqueNodes) as any[];
    const DOCUMENT_POSITION_FOLLOWING = env.window?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;
    sorted.sort((a: any, b: any) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    const finalNodes: any[] = [];
    for (const node of sorted) {
      const isChild = finalNodes.some((parent: any) => parent.contains(node));
      if (!isChild) finalNodes.push(node);
    }
    return finalNodes;
  }

  function roleFromWrapper(wrapper: any): any {
    const direct = wrapper && wrapper.getAttribute ? wrapper.getAttribute('data-message-author-role') : '';
    if (direct === 'user' || direct === 'assistant') return direct;

    const inner = wrapper && wrapper.querySelector ? wrapper.querySelector('[data-message-author-role]') : null;
    const innerRole = inner && inner.getAttribute ? inner.getAttribute('data-message-author-role') : '';
    if (innerRole === 'user' || innerRole === 'assistant') return innerRole;

    if (wrapper && wrapper.classList && wrapper.classList.contains('agent-turn')) return 'assistant';
    if (wrapper && wrapper.querySelector && wrapper.querySelector("div[class*='user']")) return 'user';
    return 'assistant';
  }

  function collectMessages({ allowEditing }: any = {}): any {
    const root = getConversationRoot();
    if (!root) return [];
    if (!allowEditing && inEditMode(root)) return [];

    const wrappers = getTurnWrappers(root);

    if (!wrappers.length) {
      const turns = Array.from(root.querySelectorAll("article[data-testid^='conversation-turn-']"));
      for (const turn of turns) wrappers.push(turn);
    }

    const out = [];
    for (let i = 0; i < wrappers.length; i += 1) {
      const el = wrappers[i];
      const role = roleFromWrapper(el);
      const node = role === 'user' ? userContentNode(el) : assistantContentNode(el);
      const raw = node ? node.innerText || node.textContent || '' : '';
      const fallbackText = env.normalize.normalizeText(raw);
      const contentText =
        role === 'assistant' && typeof chatgptMarkdown.extractAssistantText === 'function'
          ? chatgptMarkdown.extractAssistantText(el) || fallbackText
          : fallbackText;
      const imageUrls = (() => {
        const primary = extractImageUrlsFromElement(node || el);
        if (!node || node === el) return primary;
        const secondary = extractImageUrlsFromElement(el);
        return Array.from(new Set(primary.concat(secondary)));
      })();
      if (!contentText && !imageUrls.length) continue;
      const baseMarkdown =
        role === 'assistant' && typeof chatgptMarkdown.extractAssistantMarkdown === 'function'
          ? chatgptMarkdown.extractAssistantMarkdown(el) || contentText || ''
          : contentText || '';
      const contentMarkdown = appendImageMarkdown(baseMarkdown, imageUrls);
      const messageId = el.getAttribute && (el.getAttribute('data-message-id') || el.id);
      const messageKey = messageId || env.normalize.makeFallbackMessageKey({ role, contentText, sequence: i });
      out.push({
        messageKey,
        role,
        contentText,
        contentMarkdown,
        sequence: i,
        updatedAt: Date.now(),
      });
    }

    return out;
  }

  function capture(options: any): any {
    if (!matches({ hostname: env.location.hostname })) return null;
    const messages = collectMessages({ allowEditing: !!(options && options.manual) });
    if (!messages.length) return null;
    const conversationKey = findConversationIdFromUrl() || makeFallbackConversationKey(messages);
    return {
      conversation: {
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey,
        title: findTitle(),
        url: env.location.href,
        warningFlags: [],
        lastCapturedAt: Date.now(),
      },
      messages,
    };
  }

  const collector = { capture, getRoot: getConversationRoot };

  return {
    id: 'chatgpt',
    matches,
    collector,
  };
}
