import { DISCOURSE_OP_MISSING_WARNING_FLAG } from '@collectors/web/article-fetch-errors';
import { DISCOURSE_TOPIC_PATH_RE_FLAGS, DISCOURSE_TOPIC_PATH_RE_SOURCE } from '@collectors/web/article-fetch-discourse';
import { htmlToMarkdown } from '@collectors/web/article-extract/markdown';
import { htmlToMarkdownTurndown } from '@collectors/web/article-extract/markdown-turndown';
import { extractBySiteSpec } from '@collectors/web/article-extract/site-spec-extractor';
import {
  ARTICLE_FETCH_SITE_SPECS,
  extractDiscourseOpOnly,
  parseDiscourseTopicPathOnPage,
  buildWechatShareMediaGalleryHtml,
  buildWechatShareMediaGalleryMarkdown,
  extractWechatShareMediaImageUrls,
  isWechatShareMediaPage,
  waitForXiaohongshuNoteHydrated,
} from '@collectors/web/article-extract/sites';
import type { ExtractedWebArticle } from '@collectors/web/article-extract/types';
import { normalizeText } from '@collectors/web/article-extract/url';

type ExtractOptions = {
  stabilizationTimeoutMs?: number;
  stabilizationMinTextLength?: number;
};

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(content: unknown, text: unknown) {
  const normalizedContent = normalizeText(content);
  if (normalizedContent) return `<html><body>${normalizedContent}</body></html>`;
  const normalizedText = normalizeText(text);
  return `<html><body><p>${escapeHtml(normalizedText)}</p></body></html>`;
}

function readMeta(selectors: string[]) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (!node) continue;
    const content = normalizeText((node as any).getAttribute?.('content') || (node as any).textContent || '');
    if (content) return content;
  }
  return '';
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

function fallbackExtract(baseHref: string) {
  const root = pickRoot();
  if (!root) return null;
  const title =
    normalizeText(document.title || '') || readMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]']);
  const author = readMeta([
    "meta[name='author']",
    "meta[property='article:author']",
    "meta[property='og:article:author']",
  ]);
  const text = normalizeText((root as any).innerText || '');
  if (!text) return null;
  const fallbackHtml = buildHtml('', text);
  const markdown = htmlToMarkdownTurndown(fallbackHtml, baseHref) || htmlToMarkdown('', text, baseHref);
  return {
    title,
    author,
    publishedAt: readMeta([
      "meta[property='article:published_time']",
      "meta[name='publish_date']",
      "meta[name='pubdate']",
    ]),
    excerpt: '',
    contentHTML: fallbackHtml,
    contentMarkdown: markdown,
    textContent: text,
  };
}

function withDiscourseOpWarning(
  payload: Omit<ExtractedWebArticle, 'ok' | 'warningFlags'> & { warningFlags?: unknown },
  opMissingOnCurrentPage: boolean,
): ExtractedWebArticle {
  const existing = Array.isArray(payload?.warningFlags)
    ? payload.warningFlags.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (opMissingOnCurrentPage && !existing.includes(DISCOURSE_OP_MISSING_WARNING_FLAG)) {
    existing.push(DISCOURSE_OP_MISSING_WARNING_FLAG);
  }
  return { ...payload, ok: true, warningFlags: existing };
}

async function waitForDomStabilized(timeoutMs: number, minTextLength: number) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let last: any = null;
  let stableTicks = 0;

  while (Date.now() < deadline) {
    const root = pickRoot();
    const text = root ? normalizeText((root as any).innerText || '') : '';
    const nodeCount =
      root && typeof (root as any).querySelectorAll === 'function' ? (root as any).querySelectorAll('*').length : 0;
    const sample = {
      readyState: normalizeText(document.readyState || ''),
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

    const isComplete = sample.readyState.toLowerCase() === 'complete';
    const elapsedMs = Date.now() - startedAt;
    const stableAndComplete = stableTicks >= 2 && isComplete;

    // Short pages (e.g. image-first posts) may never reach `minTextLength`.
    // Still wait for the DOM to stabilize, but avoid delaying capture for the full timeout.
    if (stableAndComplete && (sample.textLen >= minTextLength || elapsedMs >= 1_200)) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

async function waitForWechatShareMediaHydrated() {
  if (!isWechatShareMediaPage()) return;

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

function normalizeDetailsElementsForReadability(doc: any) {
  if (!doc || typeof doc.querySelectorAll !== 'function' || typeof doc.createElement !== 'function') return;

  const detailsNodes = Array.from(doc.querySelectorAll('details') as any) as any[];
  if (!detailsNodes.length) return;

  for (const details of detailsNodes) {
    const detailsEl = details as any;
    if (!detailsEl || typeof detailsEl.replaceWith !== 'function') continue;

    const summary = typeof detailsEl.querySelector === 'function' ? detailsEl.querySelector(':scope > summary') : null;
    const summaryText = normalizeText(summary?.textContent || '');

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

function extractBySiteSpecs(baseHref: string) {
  for (const spec of ARTICLE_FETCH_SITE_SPECS) {
    const payload = extractBySiteSpec(spec, baseHref);
    if (!payload) continue;
    return payload;
  }
  return null;
}

function extractByReadability(baseHref: string) {
  if (typeof (globalThis as any).Readability !== 'function') return null;

  const cloned = document.cloneNode(true) as any;
  normalizeDetailsElementsForReadability(cloned);
  const article = new (globalThis as any).Readability(cloned).parse();
  if (!article) return null;

  const title = normalizeText(article.title || '');
  const author =
    normalizeText(article.byline || '') ||
    readMeta(["meta[name='author']", "meta[property='article:author']", "meta[property='og:article:author']"]);
  const content = normalizeText(article.content || '');
  const text = normalizeText(article.textContent || '');
  if (!content && !text) return null;

  const wechatGalleryHtml = buildWechatShareMediaGalleryHtml(baseHref);
  const wechatGalleryMarkdown = buildWechatShareMediaGalleryMarkdown(baseHref);
  const htmlBody = normalizeText(content) || (text ? `<p>${escapeHtml(text)}</p>` : '');
  const contentWithWechatGallery = wechatGalleryHtml ? `${htmlBody}${wechatGalleryHtml}` : htmlBody;
  const legacyMarkdownBase = htmlToMarkdown(content, text, baseHref);
  const legacyMarkdownWithWechatGallery = wechatGalleryMarkdown
    ? normalizeText(`${legacyMarkdownBase}\n\n${wechatGalleryMarkdown}`)
    : legacyMarkdownBase;
  const markdownFromTurndown = wechatGalleryHtml ? '' : htmlToMarkdownTurndown(contentWithWechatGallery, baseHref);
  const markdownWithWechatGallery = markdownFromTurndown || legacyMarkdownWithWechatGallery;

  return {
    title,
    author,
    publishedAt: readMeta([
      "meta[property='article:published_time']",
      "meta[name='publish_date']",
      "meta[name='pubdate']",
    ]),
    excerpt: normalizeText(article.excerpt || ''),
    contentHTML: buildHtml(contentWithWechatGallery, text),
    contentMarkdown: markdownWithWechatGallery,
    textContent: text,
  };
}

export async function extractWebArticleFromCurrentPage(options: ExtractOptions = {}): Promise<ExtractedWebArticle> {
  const baseHref = String(location.href || '');
  const timeoutMs = Math.max(1_000, Number(options.stabilizationTimeoutMs) || 10_000);
  const minTextLength = Math.max(120, Number(options.stabilizationMinTextLength) || 240);
  const discourseTopicPathRe = new RegExp(DISCOURSE_TOPIC_PATH_RE_SOURCE, DISCOURSE_TOPIC_PATH_RE_FLAGS);

  await waitForDomStabilized(timeoutMs, minTextLength);
  await waitForWechatShareMediaHydrated();
  await waitForXiaohongshuNoteHydrated();

  const wechatRoot = document.querySelector('#js_content') as any;
  if (wechatRoot) {
    wechatRoot.style.visibility = 'visible';
    wechatRoot.style.opacity = '1';
  }
  const noisyNodes = document.querySelectorAll('.weui-a11y_ref, #js_a11y_like_btn_tips');
  noisyNodes.forEach((node: any) => node?.remove?.());

  const sitePayload = extractBySiteSpecs(baseHref);
  if (sitePayload) {
    return withDiscourseOpWarning(
      {
        ...sitePayload,
      },
      false,
    );
  }

  const discourseTopic = parseDiscourseTopicPathOnPage(location.pathname, discourseTopicPathRe);
  const discourseOpOnly = extractDiscourseOpOnly(baseHref, discourseTopicPathRe);
  if (discourseOpOnly) {
    return withDiscourseOpWarning(
      {
        ...discourseOpOnly,
      },
      false,
    );
  }
  const discourseOpMissingOnCurrentPage = Boolean(discourseTopic);

  const readability = extractByReadability(baseHref);
  if (readability) {
    return withDiscourseOpWarning(
      {
        ...readability,
      },
      discourseOpMissingOnCurrentPage,
    );
  }

  const wechatOnlyUrls = extractWechatShareMediaImageUrls(baseHref);
  if (wechatOnlyUrls.length >= 2) {
    const markdown = buildWechatShareMediaGalleryMarkdown(baseHref);
    const html = buildWechatShareMediaGalleryHtml(baseHref);
    return withDiscourseOpWarning(
      {
        title: normalizeText(document.title || '') || 'WeChat Share Media',
        author: '',
        publishedAt: '',
        excerpt: '',
        contentHTML: buildHtml(html, ''),
        contentMarkdown: markdown,
        textContent: wechatOnlyUrls.join('\n'),
      },
      false,
    );
  }

  const fallback = fallbackExtract(baseHref);
  if (fallback) {
    return withDiscourseOpWarning(
      {
        ...fallback,
      },
      discourseOpMissingOnCurrentPage,
    );
  }

  throw new Error('No article content detected');
}
