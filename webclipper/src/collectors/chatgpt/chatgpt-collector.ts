import type { CollectorDefinition } from '../collector-contract.ts';
import type { CollectorEnv } from '../collector-env.ts';
import { appendImageMarkdown, extractImageUrlsFromElement } from '../collector-utils.ts';
import chatgptMarkdown from './chatgpt-markdown.ts';

export function createChatgptCollectorDef(env: CollectorEnv): CollectorDefinition {
  const DEEP_RESEARCH_MESSAGE_TYPES = Object.freeze({
    REQUEST: 'SYNCNOS_DEEP_RESEARCH_REQUEST',
    RESPONSE: 'SYNCNOS_DEEP_RESEARCH_RESPONSE',
  });

  const deepResearchCache = new Map<string, { markdown: string; text: string; title: string; updatedAt: number }>();
  const deepResearchInFlight = new Map<string, Promise<{ markdown: string; text: string; title: string } | null>>();
  const deepResearchPending = new Map<
    string,
    {
      resolve: (payload: { markdown: string; text: string; title: string } | null) => void;
      timeoutId: any;
      intervalId?: any;
    }
  >();
  let deepResearchListenerInstalled = false;

  function ensureDeepResearchListener() {
    if (deepResearchListenerInstalled) return;
    deepResearchListenerInstalled = true;
    env.window.addEventListener('message', (event: any) => {
      const data = event?.data;
      if (!data || data.__syncnos !== true) return;
      if (data.type !== DEEP_RESEARCH_MESSAGE_TYPES.RESPONSE) return;
      const requestId = String(data.requestId || '').trim();
      if (!requestId) return;

      const pending = deepResearchPending.get(requestId);
      if (!pending) return;
      deepResearchPending.delete(requestId);
      try {
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        if (pending.intervalId) clearInterval(pending.intervalId);
      } catch (_e) {
        // ignore
      }

      const markdown = String(data.markdown || '').trim();
      const text = String(data.text || '').trim();
      const title = String(data.title || '').trim() || 'Deep Research';
      if (!markdown && !text) {
        pending.resolve(null);
        return;
      }
      pending.resolve({ markdown, text, title });
    });
  }

  function findDeepResearchIframe(wrapper: any): any | null {
    if (!wrapper || !wrapper.querySelector) return null;
    return wrapper.querySelector("iframe[title='internal://deep-research']") || null;
  }

  function requestDeepResearchContent(iframeEl: any, options?: { timeoutMs?: number }): Promise<{ markdown: string; text: string; title: string } | null> {
    const iframeSrc = String(iframeEl?.getAttribute?.('src') || '').trim();
    const cacheKey = iframeSrc || String(iframeEl?.getAttribute?.('title') || 'deep-research');
    const cached = deepResearchCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.updatedAt < 60_000) return Promise.resolve({ markdown: cached.markdown, text: cached.text, title: cached.title });

    const existing = deepResearchInFlight.get(cacheKey);
    if (existing) return existing;

    const timeoutMs = Number.isFinite(options?.timeoutMs as any) ? Math.max(400, Number(options?.timeoutMs)) : 2500;
    const p = new Promise<{ markdown: string; text: string; title: string } | null>((resolve) => {
      try {
        ensureDeepResearchListener();

        const requestId = `dr_${now}_${Math.random().toString(16).slice(2)}`;
        const timeoutId = env.window.setTimeout(() => {
          deepResearchPending.delete(requestId);
          resolve(null);
        }, timeoutMs);

        let targetOrigin = '*';
        try {
          if (iframeSrc) targetOrigin = new URL(iframeSrc).origin;
        } catch (_e) {
          // ignore
        }

        const sendRequest = () => {
          const targetWindow = iframeEl?.contentWindow;
          if (!targetWindow || typeof targetWindow.postMessage !== 'function') return;
          try {
            targetWindow.postMessage(
              {
                __syncnos: true,
                type: DEEP_RESEARCH_MESSAGE_TYPES.REQUEST,
                requestId,
              },
              targetOrigin,
            );
          } catch (_e) {
            // ignore
          }
        };

        // Race-proof: the iframe's content script may not be ready yet. Retry for a short window.
        const intervalId = env.window.setInterval(() => {
          if (!deepResearchPending.has(requestId)) return;
          sendRequest();
        }, 250);

        deepResearchPending.set(requestId, { resolve, timeoutId, intervalId });
        sendRequest();
      } catch (_e) {
        resolve(null);
      }
    }).then((payload) => {
      if (payload) deepResearchCache.set(cacheKey, { ...payload, updatedAt: Date.now() });
      return payload;
    }).finally(() => {
      deepResearchInFlight.delete(cacheKey);
    });

    deepResearchInFlight.set(cacheKey, p);
    return p;
  }

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
    const DOCUMENT_POSITION_FOLLOWING = env.window?.Node?.DOCUMENT_POSITION_FOLLOWING ?? 4;

    function sortInDocumentOrder(nodes: any[]): any[] {
      const sorted = nodes.slice();
      sorted.sort((a: any, b: any) => {
        if (a === b) return 0;
        return a.compareDocumentPosition(b) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      return sorted;
    }

    function dropAncestors(nodes: any[]): any[] {
      if (!nodes.length) return nodes;
      return nodes.filter((node: any) => !nodes.some((other: any) => other !== node && node.contains(other)));
    }

    const roleNodes = Array.from(scope.querySelectorAll('[data-message-author-role]')) as any[];
    const articleTurnNodes = Array.from(scope.querySelectorAll("article[data-testid^='conversation-turn-']")) as any[];
    const divTurnNodes = Array.from(scope.querySelectorAll("div[data-testid='conversation-turn']")) as any[];

    // Prefer message-level nodes if available. Some modern ChatGPT DOMs group multiple assistant
    // messages inside a single `.agent-turn` container; keeping `.agent-turn` as the wrapper would
    // only capture the first message.
    if (roleNodes.length) {
      const picked = dropAncestors(roleNodes);
      const extraTurns = articleTurnNodes.filter((turn: any) => !picked.some((node: any) => turn.contains(node)));
      return sortInDocumentOrder(dropAncestors(Array.from(new Set(picked.concat(extraTurns).concat(divTurnNodes).filter(Boolean))) as any[]));
    }

    if (divTurnNodes.length || articleTurnNodes.length) {
      return sortInDocumentOrder(dropAncestors(divTurnNodes.concat(articleTurnNodes)));
    }

    const agentTurnNodes = Array.from(scope.querySelectorAll('.agent-turn')) as any[];
    return sortInDocumentOrder(dropAncestors(agentTurnNodes));
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

  async function collectMessages({ allowEditing }: any = {}): Promise<any[]> {
    const root = getConversationRoot();
    if (!root) return [];
    if (!allowEditing && inEditMode(root)) return [];

    const wrappers = getTurnWrappers(root);

    if (!wrappers.length) {
      const turns = Array.from(root.querySelectorAll("article[data-testid^='conversation-turn-']"));
      for (const turn of turns) wrappers.push(turn);
    }

    const out: any[] = [];
    for (let i = 0; i < wrappers.length; i += 1) {
      const el = wrappers[i];
      const role = roleFromWrapper(el);
      const node = role === 'user' ? userContentNode(el) : assistantContentNode(el);
      const raw = node ? node.innerText || node.textContent || '' : '';
      const fallbackText = env.normalize.normalizeText(raw);
      let contentText =
        role === 'assistant' && typeof chatgptMarkdown.extractAssistantText === 'function'
          ? chatgptMarkdown.extractAssistantText(el) || fallbackText
          : fallbackText;
      const imageUrls = (() => {
        const primary = extractImageUrlsFromElement(node || el);
        if (!node || node === el) return primary;
        const secondary = extractImageUrlsFromElement(el);
        return Array.from(new Set(primary.concat(secondary)));
      })();

      let baseMarkdown =
        role === 'assistant' && typeof chatgptMarkdown.extractAssistantMarkdown === 'function'
          ? chatgptMarkdown.extractAssistantMarkdown(el) || contentText || ''
          : contentText || '';

      const deepResearchIframe = role === 'assistant' ? findDeepResearchIframe(el) : null;
      if (role === 'assistant' && deepResearchIframe) {
        const extracted = await requestDeepResearchContent(deepResearchIframe, { timeoutMs: allowEditing ? 12000 : 2500 });
        if (extracted) {
          const markdown = String(extracted.markdown || '').trim();
          const text = String(extracted.text || '').trim();
          baseMarkdown = markdown || text || baseMarkdown || '';
          contentText = env.normalize.normalizeText(text || markdown || contentText || '');
        } else {
          // The parent page doesn't contain the report body; only the iframe does.
          // If extraction fails (timing/permissions), keep a stable placeholder so users can still recover the link.
          const iframeUrl = String(deepResearchIframe.getAttribute?.('src') || '').trim();
          const placeholder = iframeUrl ? `Deep Research (iframe): ${iframeUrl}` : 'Deep Research (iframe)';
          const normalized = String(contentText || '').trim();
          const looksLikeOnlyLabel = !normalized || /^chatgpt said:?\s*$/i.test(normalized);
          if (looksLikeOnlyLabel || !baseMarkdown) {
            contentText = placeholder;
            baseMarkdown = placeholder;
          }
        }
      }

      if (!contentText && !imageUrls.length) continue;
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

  async function capture(options: any): Promise<any | null> {
    if (!matches({ hostname: env.location.hostname })) return null;
    const messages = await collectMessages({ allowEditing: !!(options && options.manual) });
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
