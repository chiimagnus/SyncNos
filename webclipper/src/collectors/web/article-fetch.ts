import { hasConversation, syncConversationMessages, upsertConversation } from '../../conversations/data/storage';
import { scriptingExecuteScript } from '../../platform/webext/scripting';
import { tabsGet, tabsQuery } from '../../platform/webext/tabs';

const ARTICLE_SOURCE = 'web';
const ARTICLE_SOURCE_TYPE = 'article';
const READABILITY_FILE = 'src/vendor/readability.js';

function toError(message: unknown) {
  return new Error(String(message || 'unknown error'));
}

function normalizeHttpUrl(raw: unknown) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = String(url.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

function conversationKeyForUrl(url: string) {
  return `article:${url}`;
}

function normalizeText(text: unknown) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function countWords(text: string) {
  const value = normalizeText(text);
  if (!value) return 0;
  try {
    if ((globalThis as any).Intl && typeof (Intl as any).Segmenter === 'function') {
      const segmenter = new (Intl as any).Segmenter(undefined, { granularity: 'word' });
      let count = 0;
      for (const token of segmenter.segment(value)) {
        if (token && token.isWordLike) count += 1;
      }
      if (count > 0) return count;
    }
  } catch (_e) {
    // ignore and fallback
  }
  return value.split(/\s+/).filter(Boolean).length;
}

function fallbackTitle(url: string, tabTitle: unknown) {
  const preferred = normalizeText(tabTitle);
  if (preferred) return preferred;
  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch (_e) {
    return url;
  }
}

async function resolveTargetTab(tabId?: number) {
  if (Number.isFinite(Number(tabId)) && Number(tabId) > 0) {
    const tab = await tabsGet(Number(tabId));
    if (!tab || !Number.isFinite(Number(tab.id))) throw toError('target tab not found');
    return tab;
  }

  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
  if (!tab || !Number.isFinite(Number(tab.id))) throw toError('active tab not found');
  return tab;
}

async function ensureReadability(tabId: number) {
  await scriptingExecuteScript({
    target: { tabId, allFrames: false },
    files: [READABILITY_FILE],
  });
}

async function extractArticleOnTab(tabId: number) {
  const results = await scriptingExecuteScript({
    target: { tabId, allFrames: false },
    func: async ({ stabilizationTimeoutMs, stabilizationMinTextLength }: any) => {
      const timeoutMs = Math.max(1_000, Number(stabilizationTimeoutMs) || 10_000);
      const minTextLength = Math.max(120, Number(stabilizationMinTextLength) || 240);

      function normalize(value: unknown) {
        return String(value || '').replace(/\r\n/g, '\n').trim();
      }

      function escapeHtml(value: unknown) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function pickRoot() {
        return (
          document.querySelector('#js_content') ||
          document.querySelector('article') ||
          document.querySelector('main') ||
          document.body ||
          document.documentElement
        );
      }

      function readMeta(selectors: any) {
        const list = Array.isArray(selectors) ? selectors : [selectors];
        for (const selector of list) {
          if (!selector) continue;
          const node = document.querySelector(selector);
          if (!node) continue;
          const content = normalize((node as any).getAttribute?.('content') || (node as any).textContent || '');
          if (content) return content;
        }
        return '';
      }

      function buildHtml(content: unknown, text: unknown) {
        const normalizedContent = normalize(content);
        if (normalizedContent) return `<html><body>${normalizedContent}</body></html>`;
        const normalizedText = normalize(text);
        return `<html><body><p>${escapeHtml(normalizedText)}</p></body></html>`;
      }

      function normalizeInlineText(value: unknown) {
        return String(value || '').replace(/\s+/g, ' ');
      }

      function sanitizeUrl(raw: unknown) {
        const text = String(raw || '').trim();
        if (!text) return '';
        if (/^\/\//.test(text)) return `${location.protocol}${text}`;
        try {
          const resolved = new URL(text, location.href).toString();
          return /^https?:\/\//i.test(resolved) ? resolved : '';
        } catch (_e) {
          return '';
        }
      }

      function isBlockTag(tag: unknown) {
        return [
          'p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'figure', 'hr',
        ].includes(String(tag || '').toLowerCase());
      }

      function escapeMarkdownLabel(value: unknown) {
        return String(value || '').replace(/\]/g, '\\]');
      }

	      function renderInlineNode(node: any): string {
	        if (!node) return '';
	        if (node.nodeType === Node.TEXT_NODE) return normalizeInlineText(node.nodeValue || '');
	        if (node.nodeType !== Node.ELEMENT_NODE) return '';

	        const tag = String(node.tagName || '').toLowerCase();
	        if (!tag) return '';

	        if (tag === 'br') return '\n';
	        if (tag === 'img') {
	          const src = sanitizeUrl(node.getAttribute('src') || node.getAttribute('data-src') || '');
	          if (!src) return '';
	          const alt = escapeMarkdownLabel(normalize(node.getAttribute('alt') || ''));
	          return `![${alt}](${src})`;
	        }
	        if (tag === 'a') {
	          const href = sanitizeUrl(node.getAttribute('href') || '');
	          const linkedImg = node.querySelector ? node.querySelector('img') : null;
	          if (linkedImg) {
	            const src = sanitizeUrl(linkedImg.getAttribute('src') || linkedImg.getAttribute('data-src') || '');
	            if (src) {
	              const alt = escapeMarkdownLabel(
	                normalize(linkedImg.getAttribute('alt') || node.getAttribute('title') || ''),
	              );
	              const image = `![${alt}](${src})`;
	              return href ? `[${image}](${href})` : image;
	            }
	          }

	          const label = escapeMarkdownLabel(normalize(node.textContent || ''));
	          if (!label) return '';
	          if (!href) return label;
	          return `[${label}](${href})`;
	        }
	        if (tag === 'code') {
	          const text = normalize(node.textContent || '');
	          return text ? `\`${text}\`` : '';
	        }
	        if (tag === 'strong' || tag === 'b') {
	          const inner = renderInlineChildren(node);
	          return inner ? `**${inner}**` : '';
	        }
	        if (tag === 'em' || tag === 'i') {
	          const inner = renderInlineChildren(node);
	          return inner ? `*${inner}*` : '';
	        }
	        return renderInlineChildren(node);
	      }

      function renderInlineChildren(node: any): string {
        if (!node) return '';
        const parts: string[] = [];
        for (const child of Array.from(node.childNodes || [])) parts.push(renderInlineNode(child));
        return parts
          .join('')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n[ \t]+/g, '\n')
          .replace(/[ \t]{2,}/g, ' ');
      }

      function renderBlock(node: any, depth = 0): string {
        if (!node || depth > 50) return '';
        if (node.nodeType === Node.TEXT_NODE) return normalizeInlineText(node.nodeValue || '');
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = String(node.tagName || '').toLowerCase();
        if (!tag) return '';

        if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
          const level = Number(tag.slice(1));
          const text = normalize(node.textContent || '');
          if (!text) return '';
          return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${text}\n\n`;
        }

        if (tag === 'p') {
          const text = renderInlineChildren(node).trim();
          return text ? `${text}\n\n` : '';
        }

        if (tag === 'pre') {
          const text = normalize(node.textContent || '');
          return text ? `\n\`\`\`\n${text}\n\`\`\`\n\n` : '';
        }

        if (tag === 'blockquote') {
          const text = normalize(node.textContent || '');
          if (!text) return '';
          const lines = text.split('\n').map((l) => `> ${l}`);
          return `${lines.join('\n')}\n\n`;
        }

        if (tag === 'ul' || tag === 'ol') {
          const items = Array.from(node.querySelectorAll(':scope > li'));
          const out: string[] = [];
          for (const li of items) {
            const text = renderInlineChildren(li).trim();
            if (!text) continue;
            out.push(tag === 'ol' ? `1. ${text}` : `- ${text}`);
          }
          return out.length ? `${out.join('\n')}\n\n` : '';
        }

        if (tag === 'img') {
          const src = sanitizeUrl(node.getAttribute('src') || node.getAttribute('data-src') || '');
          if (!src) return '';
          const alt = escapeMarkdownLabel(normalize(node.getAttribute('alt') || ''));
          return `![${alt}](${src})\n\n`;
        }

        if (isBlockTag(tag)) {
          const parts: string[] = [];
          for (const child of Array.from(node.childNodes || [])) parts.push(renderBlock(child, depth + 1));
          return parts.join('');
        }

        // Inline fallback
        const inline = renderInlineChildren(node).trim();
        return inline ? `${inline}\n\n` : '';
      }

      function htmlToMarkdown(content: unknown, text: unknown) {
        const html = normalize(content);
        if (!html) return normalize(text);
        try {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = html;
          const root = wrapper.querySelector('article') || wrapper;
          const md = renderBlock(root);
          return normalize(md);
        } catch (_e) {
          return normalize(text);
        }
      }

      function fallbackExtract() {
        const root = pickRoot();
        if (!root) return null;
        const title =
          normalize(document.title || '') ||
          readMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]']);
        const author =
          readMeta(["meta[name='author']", "meta[property='article:author']", "meta[property='og:article:author']"]);
        const text = normalize((root as any).innerText || '');
        if (!text) return null;
        const contentHTML = buildHtml('', text);
	        return {
	          ok: true,
	          title,
	          author,
          publishedAt: readMeta(["meta[property='article:published_time']", "meta[name='publish_date']", "meta[name='pubdate']"]),
          excerpt: '',
          contentHTML,
          contentMarkdown: htmlToMarkdown('', text),
          textContent: text,
          warningFlags: [],
	        };
	      }

	      async function waitForDomStabilized() {
	        const deadline = Date.now() + timeoutMs;
	        let last: any = null;
	        let stableTicks = 0;

	        while (Date.now() < deadline) {
	          const root = pickRoot();
	          const text = root ? normalize((root as any).innerText || '') : '';
          const nodeCount =
            root && typeof (root as any).querySelectorAll === 'function'
              ? (root as any).querySelectorAll('*').length
              : 0;
          const sample = {
            readyState: normalize(document.readyState || ''),
            textLen: text.length,
            nodeCount,
          };

          if (
            last &&
            sample.readyState === last.readyState &&
            sample.textLen === last.textLen &&
            sample.nodeCount === last.nodeCount
          ) {
            stableTicks += 1;
          } else {
            stableTicks = 0;
            last = sample;
          }

          if (stableTicks >= 2 && sample.readyState.toLowerCase() === 'complete' && sample.textLen >= minTextLength) {
            return;
          }

	          // eslint-disable-next-line no-await-in-loop
	          await new Promise((resolve) => setTimeout(resolve, 350));
	        }
	      }

	      function normalizeDetailsElementsForReadability(doc: any) {
	        if (!doc || typeof doc.querySelectorAll !== 'function' || typeof doc.createElement !== 'function') return;

	        const detailsNodes = Array.from(doc.querySelectorAll('details') as any) as any[];
	        if (!detailsNodes.length) return;

	        for (const details of detailsNodes) {
	          const detailsEl = details as any;
	          if (!detailsEl || typeof detailsEl.replaceWith !== 'function') continue;

	          const summary =
	            typeof detailsEl.querySelector === 'function' ? detailsEl.querySelector(':scope > summary') : null;
	          const summaryText = normalize(summary?.textContent || '');

	          const container = doc.createElement('div');
	          container.setAttribute('data-syncnos-origin', 'details');

	          if (summaryText) {
	            const label = doc.createElement('p');
	            const strong = doc.createElement('strong');
	            strong.textContent = summaryText;
	            label.appendChild(strong);
	            container.appendChild(label);
	          }

	          const children = Array.from((detailsEl.childNodes || []) as any) as any[];
	          for (const child of children) {
	            if (!child) continue;
	            if (summary && child === summary) continue;
	            container.appendChild(child);
	          }

	          detailsEl.replaceWith(container);
	        }
	      }

	      try {
	        await waitForDomStabilized();

	        const wechatRoot = document.querySelector('#js_content') as any;
	        if (wechatRoot) {
	          wechatRoot.style.visibility = 'visible';
	          wechatRoot.style.opacity = '1';
	        }
	        const noisyNodes = document.querySelectorAll('.weui-a11y_ref, #js_a11y_like_btn_tips');
	        noisyNodes.forEach((node: any) => node?.remove?.());

	        if (typeof (globalThis as any).Readability === 'function') {
	          const cloned = document.cloneNode(true) as any;
	          normalizeDetailsElementsForReadability(cloned);
	          const article = new (globalThis as any).Readability(cloned).parse();
	          if (article) {
	            const title = normalize(article.title || '');
	            const author =
	              normalize(article.byline || '') ||
	              readMeta(["meta[name='author']", "meta[property='article:author']", "meta[property='og:article:author']"]);
	            const content = normalize(article.content || '');
	            const text = normalize(article.textContent || '');
	            if (content || text) {
              return {
                ok: true,
                title,
                author,
                publishedAt: readMeta(["meta[property='article:published_time']", "meta[name='publish_date']", "meta[name='pubdate']"]),
                excerpt: normalize(article.excerpt || ''),
                contentHTML: buildHtml(content, text),
                contentMarkdown: htmlToMarkdown(content, text),
                textContent: text,
                warningFlags: [],
              };
            }
          }
        }

        const fallback = fallbackExtract();
        if (fallback) return fallback;
        return { ok: false, error: 'No article content detected' };
      } catch (e: any) {
        const message = e && e.message ? String(e.message) : String(e || 'Article extraction failed');
        return { ok: false, error: message };
      }
    },
    args: [
      {
        stabilizationTimeoutMs: 10_000,
        stabilizationMinTextLength: 240,
      },
    ],
  });

  const payload = results && results[0] ? (results[0] as any).result : null;
  if (!payload || payload.ok !== true) {
    const reason = payload && payload.error ? payload.error : 'article extraction returned empty payload';
    throw toError(reason);
  }
  return payload;
}

export async function fetchActiveTabArticle({ tabId }: { tabId?: number } = {}) {
  const tab = await resolveTargetTab(tabId);
  const targetTabId = Number(tab.id);
  const normalizedUrl = normalizeHttpUrl(tab.url || '');
  if (!normalizedUrl) throw toError('active tab must be an http(s) page');

  await ensureReadability(targetTabId);
  const extracted = await extractArticleOnTab(targetTabId);

  const textContent = normalizeText(extracted.textContent || '');
  const markdownContent = normalizeText(extracted.contentMarkdown || '');
  const title = normalizeText(extracted.title || '') || fallbackTitle(normalizedUrl, tab.title || '');
  const author = normalizeText(extracted.author || '');
  const publishedAt = normalizeText(extracted.publishedAt || '');
  const warningFlags = Array.isArray(extracted.warningFlags)
    ? extracted.warningFlags.map((item: any) => String(item || '').trim()).filter(Boolean)
    : [];

  if (!textContent) throw toError('No article content detected');

  const capturedAt = Date.now();
  let existed = false;
  try {
    existed = await hasConversation({
      sourceType: ARTICLE_SOURCE_TYPE,
      source: ARTICLE_SOURCE,
      conversationKey: conversationKeyForUrl(normalizedUrl),
      url: normalizedUrl,
    });
  } catch (_e) {
    existed = false;
  }
  const conversation = await upsertConversation({
    sourceType: ARTICLE_SOURCE_TYPE,
    source: ARTICLE_SOURCE,
    conversationKey: conversationKeyForUrl(normalizedUrl),
    title,
    url: normalizedUrl,
    author,
    publishedAt,
    warningFlags,
    lastCapturedAt: capturedAt,
  });

  const body = textContent;
  const markdown = markdownContent || body;
  await syncConversationMessages(Number((conversation as any).id), [
    {
      messageKey: 'article_body',
      role: 'article',
      contentText: body,
      contentMarkdown: markdown,
      sequence: 1,
      updatedAt: capturedAt,
    },
  ]);

  return {
    isNew: !existed,
    conversationId: Number((conversation as any).id),
    url: normalizedUrl,
    title,
    author,
    publishedAt,
    warningFlags,
    wordCount: countWords(body),
    lastCapturedAt: capturedAt,
  };
}
