import {
  getConversationBySourceConversationKey,
  hasConversation,
  syncConversationMessages,
  upsertConversation,
} from '@services/conversations/data/storage';
import { inlineChatImagesInMessages } from '@services/conversations/data/image-inline';
import { DISCOURSE_OP_MISSING_WARNING_FLAG, DISCOURSE_OP_NOT_FOUND_ERROR } from '@collectors/web/article-fetch-errors';
import { canonicalizeArticleUrl, normalizeHttpUrl } from '@services/url-cleaning/http-url';
import { cleanTrackingParamsUrl } from '@services/url-cleaning/tracking-param-cleaner';
import { scriptingExecuteScript } from '@platform/webext/scripting';
import { tabsGet, tabsQuery, tabsUpdate } from '@platform/webext/tabs';
import { storageGet } from '@platform/storage/local';

const ARTICLE_SOURCE = 'web';
const ARTICLE_SOURCE_TYPE = 'article';
const READABILITY_FILE = 'src/vendor/readability.js';
const DISCOURSE_TOPIC_PATH_RE = /^\/t\/([^/]+)\/(\d+)(?:\/([^/]+))?\/?$/i;
const DISCOURSE_TOPIC_PATH_RE_SOURCE = '^\\/t\\/([^/]+)\\/(\\d+)(?:\\/([^/]+))?\\/?$';
const DISCOURSE_TOPIC_PATH_RE_FLAGS = 'i';
const DISCOURSE_NAVIGATION_WAIT_TIMEOUT_MS = 10_000;
const ARTICLE_STABILIZATION_TIMEOUT_MS = 10_000;
const ARTICLE_STABILIZATION_MIN_TEXT_LENGTH = 240;

function toError(message: unknown) {
  return new Error(String(message || 'unknown error'));
}

function conversationKeyForUrl(url: string) {
  return `article:${url}`;
}

function normalizeText(text: unknown) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function parseDiscourseTopicUrl(rawUrl: unknown): {
  origin: string;
  slug: string;
  topicId: string;
  postNumber: number | null;
  postSegment: string | null;
} | null {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const parsedPath = parseDiscourseTopicPath(url.pathname);
    if (!parsedPath) return null;
    const postNumberRaw = Number(parsedPath.postSegment);
    return {
      origin: url.origin,
      slug: parsedPath.slug,
      topicId: parsedPath.topicId,
      postNumber: Number.isFinite(postNumberRaw) && postNumberRaw > 0 ? postNumberRaw : null,
      postSegment: parsedPath.postSegment,
    };
  } catch (_e) {
    return null;
  }
}

function parseDiscourseTopicPath(
  pathname: unknown,
  topicPathRe: RegExp = DISCOURSE_TOPIC_PATH_RE,
): {
  slug: string;
  topicId: string;
  postSegment: string | null;
} | null {
  const text = String(pathname || '').trim();
  if (!text) return null;
  const match = text.match(topicPathRe);
  if (!match) return null;
  return {
    slug: String(match[1] || '').trim(),
    topicId: String(match[2] || '').trim(),
    postSegment: match[3] ? String(match[3]).trim() : null,
  };
}

function isSameDiscourseTopicFloorUrl(currentUrl: string, expectedUrl: string): boolean {
  const current = parseDiscourseTopicUrl(currentUrl);
  const expected = parseDiscourseTopicUrl(expectedUrl);
  if (!current || !expected) return false;
  return (
    current.origin === expected.origin &&
    current.slug === expected.slug &&
    current.topicId === expected.topicId &&
    current.postNumber === expected.postNumber
  );
}

function buildDiscourseTopicFloorUrl(
  topic: {
    origin: string;
    slug: string;
    topicId: string;
  },
  postNumber: number,
): string {
  return `${topic.origin}/t/${topic.slug}/${topic.topicId}/${Math.max(1, Math.floor(postNumber))}`;
}

function hasWarningFlag(warningFlags: unknown, flag: string): boolean {
  if (!Array.isArray(warningFlags)) return false;
  return warningFlags.some((item) => String(item || '').trim() === flag);
}

async function waitForTabUrl(targetTabId: number, expectedUrl: string, timeoutMs = 8_000): Promise<string> {
  const expected = normalizeHttpUrl(expectedUrl);
  if (!expected) throw toError('invalid expected navigation url');

  const deadline = Date.now() + Math.max(1_000, Number(timeoutMs) || 8_000);
  while (Date.now() < deadline) {
    const tab = await tabsGet(targetTabId);
    const current = normalizeHttpUrl((tab as any)?.url || '');
    if (current === expected || isSameDiscourseTopicFloorUrl(current, expected)) return current;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw toError('timed out waiting for Discourse /1 navigation');
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
    func: async ({
      stabilizationTimeoutMs,
      stabilizationMinTextLength,
      discourseTopicPathReSource,
      discourseTopicPathReFlags,
      discourseOpMissingWarningFlag,
    }: any) => {
      const timeoutMs = Math.max(1_000, Number(stabilizationTimeoutMs) || 10_000);
      const minTextLength = Math.max(120, Number(stabilizationMinTextLength) || 240);
      const topicPathPattern = String(discourseTopicPathReSource || '').trim() || '^$';
      const topicPathFlags = String(discourseTopicPathReFlags || '').trim() || 'i';
      const discourseTopicPathRe = new RegExp(topicPathPattern, topicPathFlags);
      const discourseOpMissingFlag =
        String(discourseOpMissingWarningFlag || '').trim() || 'discourse_op_missing_on_page';

      function normalize(value: unknown) {
        return String(value || '')
          .replace(/\r\n/g, '\n')
          .trim();
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

      function sanitizeWechatMediaUrl(raw: unknown) {
        const resolved = sanitizeUrl(raw);
        if (!resolved) return '';
        try {
          const url = new URL(resolved);
          url.searchParams.delete('tp');
          url.searchParams.delete('usePicPrefetch');
          url.searchParams.delete('wxfrom');
          url.searchParams.delete('from');
          return url.toString();
        } catch (_e) {
          return resolved;
        }
      }

      function extractWechatShareMediaImageUrls() {
        const hostname = String(location.hostname || '').toLowerCase();
        if (hostname !== 'mp.weixin.qq.com') return [];
        if (!document.querySelector('.share_content_page')) return [];
        if (!document.querySelector('#img_swiper_content')) return [];

        const urls: string[] = [];
        const pushUrl = (value: unknown) => {
          const url = sanitizeWechatMediaUrl(value);
          if (url) urls.push(url);
        };

        const swiperImgs = Array.from(document.querySelectorAll('.swiper_item_img img'));
        for (const img of swiperImgs) {
          const el = img as any;
          pushUrl(el.getAttribute?.('data-src') || el.getAttribute?.('src') || el.currentSrc || el.src || '');
        }

        if (urls.length < 2) {
          const thumbEls = Array.from(
            document.querySelectorAll('.swiper_indicator_list_pc [style*="background-image"]'),
          );
          for (const el of thumbEls) {
            const style = String((el as any)?.getAttribute?.('style') || '');
            const match = style.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i);
            if (!match || !match[1]) continue;
            try {
              const thumbUrl = new URL(match[1], location.href);
              // Most wechat image urls use /300 as thumbnail; /0 is the original size.
              thumbUrl.pathname = thumbUrl.pathname.replace(/\/300$/, '/0');
              pushUrl(thumbUrl.toString());
            } catch (_e) {
              // ignore
            }
          }
        }

        const seen = new Set<string>();
        const out: string[] = [];
        for (const url of urls) {
          if (seen.has(url)) continue;
          seen.add(url);
          out.push(url);
        }
        return out;
      }

      function buildWechatShareMediaGalleryHtml() {
        const imageUrls = extractWechatShareMediaImageUrls();
        if (!Array.isArray(imageUrls) || !imageUrls.length) return '';

        const imageBlocks = imageUrls
          .map(
            (url) =>
              `<p data-syncnos-origin="wechat-share-media-item"><img src="${escapeHtml(url)}" alt="" loading="lazy" style="max-width:100%;height:auto;display:block;" /></p>`,
          )
          .join('');
        return `<hr /><div data-syncnos-origin="wechat-share-media-gallery">${imageBlocks}</div>`;
      }

      function buildWechatShareMediaGalleryMarkdown() {
        const imageUrls = extractWechatShareMediaImageUrls();
        if (!Array.isArray(imageUrls) || !imageUrls.length) return '';

        const lines = ['---', ''];
        for (const url of imageUrls) {
          // Use <...> so URLs with parentheses stay valid in Markdown.
          lines.push(`![](<${url}>)`, '');
        }
        return lines.join('\n').trim();
      }

      function isBlockTag(tag: unknown) {
        return [
          'p',
          'div',
          'section',
          'article',
          'main',
          'header',
          'footer',
          'aside',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'ul',
          'ol',
          'li',
          'blockquote',
          'pre',
          'table',
          'figure',
          'hr',
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
          normalize(document.title || '') || readMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]']);
        const author = readMeta([
          "meta[name='author']",
          "meta[property='article:author']",
          "meta[property='og:article:author']",
        ]);
        const text = normalize((root as any).innerText || '');
        if (!text) return null;
        const contentHTML = buildHtml('', text);
        return {
          ok: true,
          title,
          author,
          publishedAt: readMeta([
            "meta[property='article:published_time']",
            "meta[name='publish_date']",
            "meta[name='pubdate']",
          ]),
          excerpt: '',
          contentHTML,
          contentMarkdown: htmlToMarkdown('', text),
          textContent: text,
          warningFlags: [],
        };
      }

      function withDiscourseOpWarning<T extends { warningFlags?: unknown }>(
        payload: T,
        opMissingOnCurrentPage: boolean,
      ): T & { warningFlags: string[] } {
        const existing = Array.isArray(payload?.warningFlags)
          ? payload.warningFlags.map((item) => String(item || '').trim()).filter(Boolean)
          : [];
        if (opMissingOnCurrentPage && !existing.includes(discourseOpMissingFlag)) {
          existing.push(discourseOpMissingFlag);
        }
        return {
          ...payload,
          warningFlags: existing,
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

          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      }

      async function waitForWechatShareMediaHydrated() {
        const hostname = String(location.hostname || '').toLowerCase();
        if (hostname !== 'mp.weixin.qq.com') return;
        if (!document.querySelector('.share_content_page')) return;
        if (!document.querySelector('#img_swiper_content')) return;

        const deadline = Date.now() + 1_500;
        let lastCount = 0;
        let stableTicks = 0;
        while (Date.now() < deadline) {
          const count = document.querySelectorAll('.swiper_item_img img').length;
          if (count >= 4 && count === lastCount) stableTicks += 1;
          else stableTicks = 0;
          lastCount = count;
          if (stableTicks >= 2) return;

          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }

      function parseDiscourseTopicPath(pathname: unknown): {
        slug: string;
        topicId: string;
        postNumber: string | null;
      } | null {
        const text = String(pathname || '').trim();
        if (!text) return null;
        const match = text.match(discourseTopicPathRe);
        if (!match) return null;
        return {
          slug: String(match[1] || '').trim(),
          topicId: String(match[2] || '').trim(),
          postNumber: match[3] ? String(match[3]).trim() : null,
        };
      }

      function findDiscourseOpNode(): Element | null {
        const byArticle = document.querySelector("article[data-post-number='1']");
        if (byArticle) return byArticle;

        const byTopicPost = document.querySelector(".topic-post[data-post-number='1']");
        if (byTopicPost) return byTopicPost;

        const byPostId = document.querySelector('#post_1');
        if (!byPostId) return null;
        return byPostId.closest('article') || byPostId;
      }

      function extractDiscourseOpOnly() {
        const topic = parseDiscourseTopicPath(location.pathname);
        if (!topic) return null;

        const opNode = findDiscourseOpNode();
        if (!opNode) return null;

        const cooked = opNode.querySelector('.cooked') as any;
        const contentNode = (cooked || opNode) as any;
        const content = normalize(contentNode?.innerHTML || '');
        const text = normalize(contentNode?.innerText || contentNode?.textContent || '');
        if (!content && !text) return null;

        const author =
          normalize(
            (opNode.querySelector('.topic-meta-data .username') as any)?.textContent ||
              (opNode.querySelector('.names .username') as any)?.textContent ||
              (opNode.querySelector('[data-user-card]') as any)?.getAttribute?.('data-user-card') ||
              '',
          ) ||
          readMeta(["meta[name='author']", "meta[property='article:author']", "meta[property='og:article:author']"]);

        const publishedAt =
          normalize(
            (opNode.querySelector('time') as any)?.getAttribute?.('datetime') ||
              (opNode.querySelector('time') as any)?.textContent ||
              '',
          ) ||
          readMeta(["meta[property='article:published_time']", "meta[name='publish_date']", "meta[name='pubdate']"]);

        const title =
          normalize(document.title || '') ||
          readMeta(["meta[property='og:title']", "meta[name='twitter:title']", "meta[property='title']"]);

        return {
          ok: true,
          title,
          author,
          publishedAt,
          excerpt: '',
          contentHTML: buildHtml(content, text),
          contentMarkdown: htmlToMarkdown(content, text),
          textContent: text,
          warningFlags: [],
        };
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
        await waitForWechatShareMediaHydrated();

        const wechatRoot = document.querySelector('#js_content') as any;
        if (wechatRoot) {
          wechatRoot.style.visibility = 'visible';
          wechatRoot.style.opacity = '1';
        }
        const noisyNodes = document.querySelectorAll('.weui-a11y_ref, #js_a11y_like_btn_tips');
        noisyNodes.forEach((node: any) => node?.remove?.());

        const discourseTopic = parseDiscourseTopicPath(location.pathname);
        const discourseOpOnly = extractDiscourseOpOnly();
        if (discourseOpOnly) {
          return withDiscourseOpWarning(discourseOpOnly, false);
        }
        const discourseOpMissingOnCurrentPage = Boolean(discourseTopic);

        if (typeof (globalThis as any).Readability === 'function') {
          const cloned = document.cloneNode(true) as any;
          normalizeDetailsElementsForReadability(cloned);
          const article = new (globalThis as any).Readability(cloned).parse();
          if (article) {
            const title = normalize(article.title || '');
            const author =
              normalize(article.byline || '') ||
              readMeta([
                "meta[name='author']",
                "meta[property='article:author']",
                "meta[property='og:article:author']",
              ]);
            const content = normalize(article.content || '');
            const text = normalize(article.textContent || '');
            if (content || text) {
              const wechatGalleryHtml = buildWechatShareMediaGalleryHtml();
              const wechatGalleryMarkdown = buildWechatShareMediaGalleryMarkdown();
              const htmlBody = normalize(content) || (text ? `<p>${escapeHtml(text)}</p>` : '');
              const contentWithWechatGallery = wechatGalleryHtml ? `${htmlBody}${wechatGalleryHtml}` : htmlBody;
              const markdownBase = htmlToMarkdown(content, text);
              const markdownWithWechatGallery = wechatGalleryMarkdown
                ? normalize(`${markdownBase}\n\n${wechatGalleryMarkdown}`)
                : markdownBase;
              return withDiscourseOpWarning(
                {
                  ok: true,
                  title,
                  author,
                  publishedAt: readMeta([
                    "meta[property='article:published_time']",
                    "meta[name='publish_date']",
                    "meta[name='pubdate']",
                  ]),
                  excerpt: normalize(article.excerpt || ''),
                  contentHTML: buildHtml(contentWithWechatGallery, text),
                  contentMarkdown: markdownWithWechatGallery,
                  textContent: text,
                  warningFlags: [],
                },
                discourseOpMissingOnCurrentPage,
              );
            }
          }
        }

        const fallback = fallbackExtract();
        if (fallback) return withDiscourseOpWarning(fallback, discourseOpMissingOnCurrentPage);
        return { ok: false, error: 'No article content detected' };
      } catch (e: any) {
        const message = e && e.message ? String(e.message) : String(e || 'Article extraction failed');
        return { ok: false, error: message };
      }
    },
    args: [
      {
        stabilizationTimeoutMs: ARTICLE_STABILIZATION_TIMEOUT_MS,
        stabilizationMinTextLength: ARTICLE_STABILIZATION_MIN_TEXT_LENGTH,
        discourseTopicPathReSource: DISCOURSE_TOPIC_PATH_RE_SOURCE,
        discourseTopicPathReFlags: DISCOURSE_TOPIC_PATH_RE_FLAGS,
        discourseOpMissingWarningFlag: DISCOURSE_OP_MISSING_WARNING_FLAG,
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
  const cleanedUrl = (await cleanTrackingParamsUrl(normalizedUrl)) || normalizedUrl;
  const discourseTopic = parseDiscourseTopicUrl(cleanedUrl);
  const canonicalUrl = canonicalizeArticleUrl(cleanedUrl) || cleanedUrl;

  await ensureReadability(targetTabId);
  let extracted = await extractArticleOnTab(targetTabId);

  const shouldFallbackToFirstFloor =
    discourseTopic &&
    hasWarningFlag((extracted as any)?.warningFlags, DISCOURSE_OP_MISSING_WARNING_FLAG) &&
    discourseTopic.postNumber !== 1 &&
    (discourseTopic.postNumber != null || discourseTopic.postSegment != null);

  if (shouldFallbackToFirstFloor) {
    const firstFloorUrl = buildDiscourseTopicFloorUrl(discourseTopic, 1);
    await tabsUpdate(targetTabId, { url: firstFloorUrl });
    await waitForTabUrl(targetTabId, firstFloorUrl, DISCOURSE_NAVIGATION_WAIT_TIMEOUT_MS);
    extracted = await extractArticleOnTab(targetTabId);
  }

  if (discourseTopic && hasWarningFlag((extracted as any)?.warningFlags, DISCOURSE_OP_MISSING_WARNING_FLAG)) {
    throw toError(DISCOURSE_OP_NOT_FOUND_ERROR);
  }

  const textContent = normalizeText(extracted.textContent || '');
  const markdownContent = normalizeText(extracted.contentMarkdown || '');
  const title = normalizeText(extracted.title || '') || fallbackTitle(canonicalUrl, tab.title || '');
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
      conversationKey: conversationKeyForUrl(canonicalUrl),
      url: canonicalUrl,
    });
  } catch (_e) {
    existed = false;
  }
  const conversation = await upsertConversation({
    sourceType: ARTICLE_SOURCE_TYPE,
    source: ARTICLE_SOURCE,
    conversationKey: conversationKeyForUrl(canonicalUrl),
    title,
    url: canonicalUrl,
    author,
    publishedAt,
    warningFlags,
    lastCapturedAt: capturedAt,
  });

  const body = textContent;
  const markdown = markdownContent || body;
  const conversationId = Number((conversation as any).id);
  let messagesToSave = [
    {
      messageKey: 'article_body',
      role: 'article',
      contentText: body,
      contentMarkdown: markdown,
      sequence: 1,
      updatedAt: capturedAt,
    },
  ];

  try {
    const local = await storageGet(['web_article_cache_images_enabled']);
    if (local?.web_article_cache_images_enabled === true) {
      const inlined = await inlineChatImagesInMessages({
        conversationId,
        conversationUrl: canonicalUrl,
        messages: messagesToSave,
        enableHttpImages: true,
      });
      messagesToSave = inlined.messages;
      if (
        inlined.inlinedCount > 0 ||
        inlined.downloadedCount > 0 ||
        inlined.fromCacheCount > 0 ||
        (Array.isArray(inlined.warningFlags) && inlined.warningFlags.length)
      ) {
        console.info('[ImageInline][ArticleFetch]', {
          conversationId,
          inlinedCount: inlined.inlinedCount,
          downloadedCount: inlined.downloadedCount,
          fromCacheCount: inlined.fromCacheCount,
          inlinedBytes: inlined.inlinedBytes,
          warningFlags: inlined.warningFlags,
        });
      }
    }
  } catch (error) {
    console.warn('[ImageInline][ArticleFetch] failed but capture continues', {
      conversationId,
      error: error instanceof Error ? error.message : String(error || ''),
    });
  }

  await syncConversationMessages(conversationId, messagesToSave);

  return {
    isNew: !existed,
    conversationId,
    url: canonicalUrl,
    title,
    author,
    publishedAt,
    warningFlags,
    wordCount: countWords(body),
    lastCapturedAt: capturedAt,
  };
}

export async function resolveOrCaptureActiveTabArticle({ tabId }: { tabId?: number } = {}) {
  const tab = await resolveTargetTab(tabId);
  const normalizedUrl = normalizeHttpUrl(tab.url || '');
  if (!normalizedUrl) throw toError('active tab must be an http(s) page');
  const cleanedUrl = (await cleanTrackingParamsUrl(normalizedUrl)) || normalizedUrl;
  const canonicalUrl = canonicalizeArticleUrl(cleanedUrl) || cleanedUrl;

  const key = conversationKeyForUrl(canonicalUrl);
  try {
    const existing = await getConversationBySourceConversationKey(ARTICLE_SOURCE, key);
    const existingId = Number((existing as any)?.id);
    if (existing && Number.isFinite(existingId) && existingId > 0) {
      const warningFlags = Array.isArray((existing as any)?.warningFlags)
        ? (existing as any).warningFlags.map((x: any) => String(x || '').trim()).filter(Boolean)
        : [];
      return {
        isNew: false,
        conversationId: existingId,
        url: canonicalUrl,
        title: normalizeText((existing as any)?.title || '') || fallbackTitle(canonicalUrl, (tab as any)?.title || ''),
        author: normalizeText((existing as any)?.author || ''),
        publishedAt: normalizeText((existing as any)?.publishedAt || ''),
        warningFlags,
        wordCount: null,
        lastCapturedAt: Number((existing as any)?.lastCapturedAt) || null,
      };
    }
  } catch (_e) {
    // ignore and fallback to capture
  }

  return await fetchActiveTabArticle({ tabId: Number((tab as any)?.id) });
}
