import collectorContext from '../collector-context.ts';

const NS: any = collectorContext as any;

function matches(loc: any): any {
  const hostname = loc && loc.hostname ? loc.hostname : location.hostname;
  return /(^|\.)aistudio\.google\.com$/.test(hostname) || /(^|\.)makersuite\.google\.com$/.test(hostname);
}

function isValidConversationUrl(): any {
  try {
    const p = location.pathname || '';
    if (!p || p === '/') return false;
    return true;
  } catch (_e) {
    return false;
  }
}

function findConversationKey(): any {
  return NS.collectorUtils.conversationKeyFromLocation(location);
}

function geminiMarkdown(): any {
  return NS.geminiMarkdown || {};
}

function getConversationRoot(): any {
  return document.querySelector('#chat-history') || document.querySelector('main') || document.body;
}

function inEditMode(root: any): any {
  return NS.collectorUtils.inEditMode(root);
}

function normalizeTitle(value: any): any {
  const text = value == null ? '' : String(value);
  if (NS.normalize && typeof NS.normalize.normalizeText === 'function') {
    return NS.normalize.normalizeText(text);
  }
  return text.replace(/\s+/g, ' ').trim();
}

function extractConversationTitle(): any {
  const selectors = [
    "[data-test-id='conversation-title']",
    '.conversation-title-container .conversation-title-column [class*="gds-title"]',
    '.conversation-title-container .conversation-title-column',
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const title = normalizeTitle((el as any).textContent || (el as any).innerText || '');
    if (title) return title;
  }
  const pageTitle = normalizeTitle(document.title || '');
  return pageTitle || 'Google AI Studio';
}

function extractAssistantMarkdown(node: any, fallbackText: any): any {
  const md = geminiMarkdown();
  if (typeof md.extractAssistantMarkdown === 'function') {
    const markdown = md.extractAssistantMarkdown(node);
    if (markdown) return markdown;
  }
  return fallbackText || '';
}

function extractAssistantText(node: any): any {
  const md = geminiMarkdown();
  if (typeof md.extractAssistantText === 'function') {
    const text = md.extractAssistantText(node);
    if (text) return text;
  }
  const raw = node ? node.innerText || node.textContent || '' : '';
  return NS.normalize.normalizeText(raw);
}

function collectMessages(): any {
  const root = getConversationRoot();
  if (!root) return [];
  if (inEditMode(root)) return [];

  const blocks: any[] = Array.from(root.querySelectorAll('.conversation-container')) as any[];
  if (!blocks.length) return [];

  const out: any[] = [];
  const utils = NS.collectorUtils || {};
  const extractImages = typeof utils.extractImageUrlsFromElement === 'function' ? utils.extractImageUrlsFromElement : null;
  const appendImageMd = typeof utils.appendImageMarkdown === 'function' ? utils.appendImageMarkdown : null;
  let seq = 0;
  for (const b of blocks) {
    const user =
      b.querySelector('user-query .query-text') || b.querySelector("[data-test-id='user-message']") || null;
    if (user) {
      const text = NS.normalize.normalizeText(user.innerText || user.textContent || '');
      const imageUrls = extractImages ? extractImages(user) : [];
      if (text || imageUrls.length) {
        const contentText = text || '';
        const contentMarkdown = appendImageMd ? appendImageMd(contentText, imageUrls) : contentText;
        out.push({
          messageKey: NS.normalize.makeFallbackMessageKey({ role: 'user', contentText, sequence: seq }),
          role: 'user',
          contentText,
          contentMarkdown,
          sequence: seq,
          updatedAt: Date.now(),
        });
        seq += 1;
      }
    }

    const model = b.querySelector('model-response') || b.querySelector('model-response .model-response-text') || null;
    if (model) {
      const text = extractAssistantText(model);
      const imageUrls = extractImages ? extractImages(model) : [];
      if (text || imageUrls.length) {
        const contentText = text || '';
        const baseMarkdown = extractAssistantMarkdown(model, contentText);
        const contentMarkdown = appendImageMd
          ? appendImageMd(baseMarkdown || contentText, imageUrls)
          : baseMarkdown || contentText;
        out.push({
          messageKey: NS.normalize.makeFallbackMessageKey({ role: 'assistant', contentText, sequence: seq }),
          role: 'assistant',
          contentText,
          contentMarkdown,
          sequence: seq,
          updatedAt: Date.now(),
        });
        seq += 1;
      }
    }
  }
  return out;
}

function capture(): any {
  if (!matches({ hostname: location.hostname }) || !isValidConversationUrl()) return null;
  const messages = collectMessages();
  if (!messages.length) return null;
  return {
    conversation: {
      sourceType: 'chat',
      source: 'googleaistudio',
      conversationKey: findConversationKey(),
      title: extractConversationTitle(),
      url: location.href,
      warningFlags: [],
      lastCapturedAt: Date.now(),
    },
    messages,
  };
}

const api = {
  capture,
  getRoot: getConversationRoot,
  __test: {
    collectMessages,
    extractAssistantMarkdown,
    extractAssistantText,
  },
};
NS.collectors = NS.collectors || {};
NS.collectors.googleaistudio = api;
if (NS.collectorsRegistry && NS.collectorsRegistry.register) {
  NS.collectorsRegistry.register({ id: 'googleaistudio', matches, collector: api });
}

