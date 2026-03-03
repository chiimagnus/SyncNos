import type { CollectorDefinition } from '../collector-contract.ts';
import type { CollectorEnv } from '../collector-env.ts';
import {
  appendImageMarkdown,
  conversationKeyFromLocation,
  extractImageUrlsFromElement,
  inEditMode as inEditModeUtil,
} from '../collector-utils.ts';
import geminiMarkdown from '../gemini/gemini-markdown.ts';

let manualTurnCache: Map<string, any> | null = null;
let manualCacheConversationKey: string = '';

function sleep(ms: any): any {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function normalizeRoleFromTurn(turn: Element): 'user' | 'assistant' | null {
  const container = turn.querySelector('.chat-turn-container');
  if (container && (container as any).classList) {
    const cls = (container as any).classList;
    if (cls.contains('user')) return 'user';
    if (cls.contains('model')) return 'assistant';
  }
  const marker = turn.querySelector('[data-turn-role]');
  const roleText = marker && (marker as any).getAttribute ? String((marker as any).getAttribute('data-turn-role') || '') : '';
  if (/user/i.test(roleText)) return 'user';
  if (/model|assistant/i.test(roleText)) return 'assistant';
  return null;
}

function pickTurnContent(turn: Element, role: 'user' | 'assistant'): Element | null {
  const roleSelector = role === 'user' ? '[data-turn-role="User"] .turn-content' : '[data-turn-role="Model"] .turn-content';
  const scoped = turn.querySelector(roleSelector);
  if (scoped) return scoped as any;
  const anyContent = turn.querySelector('.turn-content');
  return (anyContent as any) || null;
}

export function createGoogleAiStudioCollectorDef(env: CollectorEnv): CollectorDefinition {
  function matches(loc: any): any {
    const hostname = loc && loc.hostname ? loc.hostname : env.location.hostname;
    return /(^|\.)aistudio\.google\.com$/.test(hostname) || /(^|\.)makersuite\.google\.com$/.test(hostname);
  }

  function isValidConversationUrl(): any {
    try {
      const p = env.location.pathname || '';
      if (!p || p === '/') return false;
      return true;
    } catch (_e) {
      return false;
    }
  }

  function findConversationKey(): any {
    return conversationKeyFromLocation(env.location);
  }

  function getConversationRoot(): any {
    return env.document.querySelector('.chat-session-content') || env.document.querySelector('main') || env.document.body;
  }

  function inEditMode(root: any): any {
    return inEditModeUtil(root);
  }

  function messageKeyFromTurn(turn: Element, role: any, contentText: any, sequence: any): any {
    const id = (turn as any).getAttribute ? String((turn as any).getAttribute('id') || '').trim() : '';
    if (id) return `${id}:${role}`;
    return env.normalize.makeFallbackMessageKey({ role, contentText, sequence });
  }

  function normalizeTitle(value: any): any {
    const text = value == null ? '' : String(value);
    return env.normalize.normalizeText(text);
  }

  function extractConversationTitle(): any {
    const selectors = [
      "[data-test-id='conversation-title']",
      '.conversation-title-container .conversation-title-column [class*="gds-title"]',
      '.conversation-title-container .conversation-title-column',
    ];
    for (const selector of selectors) {
      const el = env.document.querySelector(selector);
      if (!el) continue;
      const title = normalizeTitle((el as any).textContent || (el as any).innerText || '');
      if (title) return title;
    }
    const pageTitle = normalizeTitle(env.document.title || '');
    return pageTitle || 'Google AI Studio';
  }

  function extractAssistantMarkdown(node: any, fallbackText: any): any {
    if (typeof geminiMarkdown.extractAssistantMarkdown === 'function') {
      const markdown = geminiMarkdown.extractAssistantMarkdown(node);
      if (markdown) return markdown;
    }
    return fallbackText || '';
  }

  function extractAssistantText(node: any): any {
    if (typeof geminiMarkdown.extractAssistantText === 'function') {
      const text = geminiMarkdown.extractAssistantText(node);
      if (text) return text;
    }
    const raw = node ? node.innerText || node.textContent || '' : '';
    return env.normalize.normalizeText(raw);
  }

function stripThinkingFromNode(node: Element | null): Element | null {
  if (!node || typeof (node as any).cloneNode !== 'function') return node;
  const cloned = (node as any).cloneNode(true) as Element;
  const selectors = [
    'ms-thought-chunk',
    '.thought-panel',
    'img[alt="Thinking"]',
    '.thinking-progress-icon',
  ];
  for (const selector of selectors) {
    try {
      const list = Array.from((cloned as any).querySelectorAll?.(selector) || []);
      for (const el of list) {
        try {
          (el as any).remove?.();
        } catch (_e) {
          // ignore
        }
      }
    } catch (_e) {
      // ignore
    }
  }
  return cloned;
}

function stripTurnChromeFromNode(node: Element | null): Element | null {
  if (!node || typeof (node as any).cloneNode !== 'function') return node;
  const cloned = (node as any).cloneNode(true) as Element;
  const selectors = [
    '.author-label',
    '.timestamp',
  ];
  for (const selector of selectors) {
    try {
      const list = Array.from((cloned as any).querySelectorAll?.(selector) || []);
      for (const el of list) {
        try {
          (el as any).remove?.();
        } catch (_e) {
          // ignore
        }
      }
    } catch (_e) {
      // ignore
    }
  }
  return cloned;
}

function cleanTurnContentNode(node: Element | null): Element | null {
  const noThinking = stripThinkingFromNode(node);
  return stripTurnChromeFromNode(noThinking);
}

function extractMessageFromTurn(turn: Element, sequence: number): any | null {
  const role = normalizeRoleFromTurn(turn);
  if (!role) return null;

  const contentEl = pickTurnContent(turn, role);
  if (!contentEl) return null;
  const cleanedContent = cleanTurnContentNode(contentEl as any) || contentEl;

  const updatedAt = Date.now();
  if (role === 'user') {
    const text = env.normalize.normalizeText((cleanedContent as any).innerText || (cleanedContent as any).textContent || '');
    const imageUrls = extractImageUrlsFromElement(cleanedContent);
    if (!text && !imageUrls.length) return null;
    const contentText = text || '';
    const contentMarkdown = appendImageMarkdown(contentText, imageUrls);
    return {
      messageKey: messageKeyFromTurn(turn, 'user', contentText, sequence),
      role: 'user',
      contentText,
      contentMarkdown,
      sequence,
      updatedAt,
    };
  }

  const text = extractAssistantText(cleanedContent);
  const imageUrls = extractImageUrlsFromElement(cleanedContent);
  if (!text && !imageUrls.length) return null;

  const contentText = text || '';
  const baseMarkdown = extractAssistantMarkdown(cleanedContent, contentText);
  const contentMarkdown = appendImageMarkdown(baseMarkdown || contentText, imageUrls);
  return {
    messageKey: messageKeyFromTurn(turn, 'assistant', contentText, sequence),
    role: 'assistant',
    contentText,
    contentMarkdown,
    sequence,
    updatedAt,
  };
}

function collectMessages(): any {
  const root = getConversationRoot();
  if (!root) return [];
  if (inEditMode(root)) return [];

  const turns: any[] = Array.from(root.querySelectorAll('ms-chat-turn')) as any[];
  if (!turns.length) return [];

  const out: any[] = [];
  let seq = 0;
  for (const turn of turns) {
    const msg = extractMessageFromTurn(turn, seq);
    if (!msg) continue;
    out.push(msg);
    seq += 1;
  }
  return out;
}

async function prepareManualCapture(options: any = {}): Promise<any> {
  if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return false;

  const root = getConversationRoot();
  if (!root) return false;

  const turns: Element[] = Array.from(root.querySelectorAll('ms-chat-turn')) as any;
  if (!turns.length) return false;

  const maxTurns = Math.max(1, Number(options.maxTurns) || 240);
  const settleMs = Math.max(0, Number(options.settleMs) || 80);
  const perTurnTimeoutMs = Math.max(120, Number(options.perTurnTimeoutMs) || 900);
  const pollMs = Math.max(30, Number(options.pollMs) || 80);

  const conversationKey = String(findConversationKey() || '').trim();
  manualCacheConversationKey = conversationKey;
  manualTurnCache = new Map<string, any>();

  const bottomTurn = turns[turns.length - 1] || null;

  const total = Math.min(maxTurns, turns.length);
  for (let i = 0; i < total; i += 1) {
    const turn = turns[i];
    const role = normalizeRoleFromTurn(turn);
    if (!role) continue;

    try {
      (turn as any).scrollIntoView?.({ block: 'center' });
    } catch (_e) {
      // ignore
    }

    const start = Date.now();
    while ((Date.now() - start) <= perTurnTimeoutMs) {
      const contentEl = pickTurnContent(turn, role);
      if (contentEl) {
        const checkEl = cleanTurnContentNode(contentEl as any) || contentEl;
        const text = String((checkEl as any).textContent || '').replace(/\s+/g, ' ').trim();
        const hasImage = !!(checkEl as any).querySelector?.('img');
        if (text || hasImage) break;
      }
      await sleep(pollMs);
    }

    if (settleMs) await sleep(settleMs);

    const msg = extractMessageFromTurn(turn, 0);
    if (!msg) continue;
    const turnId = (turn as any).getAttribute ? String((turn as any).getAttribute('id') || '').trim() : '';
    if (turnId) manualTurnCache.set(turnId, msg);
  }

  try {
    (bottomTurn as any)?.scrollIntoView?.({ block: 'end' });
  } catch (_e) {
    // ignore
  }

  return true;
}

function capture(options: any = {}): any {
  if (!matches({ hostname: env.location.hostname }) || !isValidConversationUrl()) return null;
  const manual = options && options.manual === true;
  let messages: any[] = [];

  const currentConversationKey = String(findConversationKey() || '').trim();
  if (manual && manualTurnCache && manualCacheConversationKey && manualCacheConversationKey === currentConversationKey) {
    const root = getConversationRoot();
    const turns: Element[] = root ? (Array.from(root.querySelectorAll('ms-chat-turn')) as any) : [];
    for (const turn of turns) {
      const turnId = (turn as any).getAttribute ? String((turn as any).getAttribute('id') || '').trim() : '';
      if (!turnId) continue;
      const hit = manualTurnCache.get(turnId);
      if (hit) messages.push(hit);
    }
    messages = messages.map((m, idx) => ({ ...m, sequence: idx, updatedAt: Date.now() }));
    manualTurnCache = null;
    manualCacheConversationKey = '';
  } else {
    messages = collectMessages();
  }

  if (!messages.length) return null;
  return {
    conversation: {
      sourceType: 'chat',
      source: 'googleaistudio',
      conversationKey: findConversationKey(),
      title: extractConversationTitle(),
      url: env.location.href,
      warningFlags: [],
      lastCapturedAt: Date.now(),
    },
    messages,
  };
}

const collector = {
  capture,
  getRoot: getConversationRoot,
  prepareManualCapture,
  __test: {
    collectMessages,
    extractAssistantMarkdown,
    extractAssistantText,
  },
};

return { id: 'googleaistudio', matches, collector };
}
