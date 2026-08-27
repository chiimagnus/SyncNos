import { DISCOURSE_OP_MISSING_WARNING_FLAG } from '@collectors/web/article-fetch-errors';
import { DISCOURSE_TOPIC_PATH_RE_FLAGS, DISCOURSE_TOPIC_PATH_RE_SOURCE } from '@collectors/web/article-fetch-discourse';
import { ARTICLE_FETCH_SITE_SPECS } from '@collectors/web/article-fetch-sites';
import { extractXiaohongshuComments } from '@collectors/web/article-fetch-sites/xiaohongshu-note';
import { extractByDefuddle } from '@collectors/web/article-extract/defuddle';
import { htmlToMarkdownTurndown } from '@collectors/web/article-extract/markdown-turndown';
import { extractBySiteSpec } from '@collectors/web/article-extract/site-spec-extractor';
import {
  extractDiscourseOpOnly,
  parseDiscourseTopicPathOnPage,
  buildWechatShareMediaGalleryHtml,
  extractWechatShareMediaImageUrls,
  isWechatShareMediaPage,
  normalizeWechatRichMediaContent,
  prepareWechatRichMediaDom,
  waitForXiaohongshuNoteHydrated,
} from '@collectors/web/article-extract/sites';
import type { ExtractedWebArticle } from '@collectors/web/article-extract/types';
import { normalizeText } from '@collectors/web/article-extract/url';

type ExtractOptions = {
  stabilizationTimeoutMs?: number;
  stabilizationMinTextLength?: number;
  includeXiaohongshuComments?: boolean;
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

function readElementText(el: Element | Document | null): string {
  if (!el) return '';
  return normalizeText((el as any).innerText || (el as any).textContent || '');
}

function isArticleExtractDebugEnabled() {
  try {
    const href = String(location?.href || '');
    if (/https?:\/\/([^/]+\.)?dedao\.cn\//i.test(href)) return true;
  } catch (_e) {
    // ignore
  }

  try {
    return Boolean((globalThis as any).__SYNCNOS_DEBUG_ARTICLE_EXTRACT__);
  } catch (_e) {
    return false;
  }
}

function summarizeElementForDebug(root: Element | Document | null) {
  if (!root || !(root as any).nodeType) return null;
  const el = (root as any).nodeType === 9 ? (root as Document).documentElement : (root as Element);
  if (!el) return null;

  const id = String((el as any).id || '').trim();
  const className = String((el as any).className || '')
    .trim()
    .replace(/\s+/g, ' ');
  const tag = String((el as any).tagName || '').toLowerCase();
  const text = readElementText(el as any);
  const childCount = Array.isArray((el as any).children)
    ? (el as any).children.length
    : ((el as any).children?.length ?? 0);
  return {
    tag,
    id,
    className,
    childCount,
    textLen: text.length,
    textPreview: text.slice(0, 200),
  };
}

function debugArticleExtract(stage: string, payload: Record<string, unknown>) {
  if (!isArticleExtractDebugEnabled()) return;
  console.info(`[ArticleExtract][Debug] ${stage}`, payload);
}

function isSkippableRootCandidate(el: Element): boolean {
  const name = String((el as any)?.tagName || '').toLowerCase();
  return name === 'script' || name === 'style' || name === 'noscript';
}

function listMeaningfulChildren(root: Element | null) {
  if (!root) return [] as Element[];
  return Array.from((root as any).children || []).filter((child): child is Element => {
    return Boolean(child) && !isSkippableRootCandidate(child as Element);
  });
}

function readCandidateTextLen(root: Element | null) {
  return root ? readElementText(root as any).length : 0;
}

function narrowFallbackRoot(root: Element | null) {
  if (!root) return root;

  let current: Element | null = root;
  while (current) {
    const children = listMeaningfulChildren(current);
    if (children.length !== 1) break;

    const onlyChild = children[0];
    const parentTextLen = readCandidateTextLen(current);
    const childTextLen = readCandidateTextLen(onlyChild);
    if (childTextLen < 800 || childTextLen < Math.floor(parentTextLen * 0.6)) break;
    current = onlyChild;
  }

  if (!current) return root;

  const tagName = String((current as any)?.tagName || '').toLowerCase();
  if (tagName !== 'div' && tagName !== 'body') return current;

  const children = listMeaningfulChildren(current);
  if (!children.length) return current;

  const parentTextLen = readCandidateTextLen(current);
  let best: Element | null = null;
  let bestTextLen = 0;
  for (const child of children) {
    const childTextLen = readCandidateTextLen(child);
    if (childTextLen <= bestTextLen) continue;
    best = child;
    bestTextLen = childTextLen;
  }

  if (!best || bestTextLen < 800) return current;
  if (bestTextLen < Math.floor(parentTextLen * 0.6)) return current;
  return best;
}

function pickPrimaryRootFromBody() {
  const body = document.body as any;
  if (!body || !body.children) return null;

  const hasInnerText = typeof body.innerText === 'string';

  // `innerText` is preferred (excludes scripts/styles), but some environments (e.g. JSDOM) only provide `textContent`.
  // Strip obvious noise so the heuristic is stable across runtimes.
  const bodyTextLen = hasInnerText
    ? normalizeText(body.innerText).length
    : (() => {
        const bodyClone = body.cloneNode(true) as Element;
        try {
          bodyClone.querySelectorAll?.('script,style,noscript')?.forEach?.((node: any) => node?.remove?.());
        } catch (_e) {
          // ignore clone clean failures
        }
        return readElementText(bodyClone).length;
      })();
  if (bodyTextLen < 800) return null;

  const children = Array.from(body.children || []) as Element[];
  let best: Element | null = null;
  let bestTextLen = 0;
  for (const child of children) {
    if (!child || isSkippableRootCandidate(child)) continue;
    const len = hasInnerText
      ? normalizeText((child as any).innerText).length
      : (() => {
          const clone = child.cloneNode(true) as Element;
          try {
            clone.querySelectorAll?.('script,style,noscript')?.forEach?.((node: any) => node?.remove?.());
          } catch (_e) {
            // ignore clone clean failures
          }
          return readElementText(clone).length;
        })();
    if (len <= bestTextLen) continue;
    best = child;
    bestTextLen = len;
  }

  if (!best || bestTextLen < 800) return null;

  // If a single direct child contains almost all visible text, prefer it over `<body>` to avoid layout/noise wrappers.
  if (bestTextLen >= Math.max(800, Math.floor(bodyTextLen * 0.72))) return best;
  return null;
}

function pickRoot() {
  return (
    document.querySelector('#js_content') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('#__next') ||
    document.querySelector('#root') ||
    document.querySelector('#app') ||
    pickPrimaryRootFromBody() ||
    document.querySelector('article') ||
    document.body ||
    document.documentElement
  );
}

function shouldTreatExtractionAsPartial(candidateTextLen: number, rootTextLen: number): boolean {
  if (!(candidateTextLen > 0) || !(rootTextLen > 0)) return false;

  // Only run this heuristic on long pages, and only when the extracted text is clearly much shorter.
  if (rootTextLen < 8_000) return false;
  if (candidateTextLen > 3_000) return false;

  const ratio = candidateTextLen / rootTextLen;
  if (ratio >= 0.3) return false;

  const delta = rootTextLen - candidateTextLen;
  return delta >= 3_200;
}

function shouldRejectDefuddleMicroCandidate(candidateTextLen: number, rootTextLen: number): boolean {
  if (!(candidateTextLen > 0) || !(rootTextLen > 0)) return false;
  if (rootTextLen < 1_800) return false;
  if (candidateTextLen >= 160) return false;

  const ratio = candidateTextLen / rootTextLen;
  if (ratio >= 0.12) return false;

  const delta = rootTextLen - candidateTextLen;
  return delta >= 1_000;
}

function shouldRejectReadabilityCandidate(candidateText: unknown, rootTextLen: number): boolean {
  const candidateTextLen = normalizeText(candidateText || '').length;
  if (!(candidateTextLen > 0) || !(rootTextLen > 0)) return false;
  if (rootTextLen < 8_000) return false;
  if (candidateTextLen >= 200) return false;

  const ratio = candidateTextLen / rootTextLen;
  if (ratio >= 0.05) return false;

  const delta = rootTextLen - candidateTextLen;
  return delta >= 3_200;
}

function fallbackExtract(baseHref: string) {
  const wechatOnlyUrls = extractWechatShareMediaImageUrls(baseHref);
  if (wechatOnlyUrls.length >= 2) {
    const hostname = String(location.hostname || '').toLowerCase();
    const root = pickRoot();
    const strippedRoot =
      hostname === 'mp.weixin.qq.com' && root ? normalizeWechatRichMediaContent(root as any, baseHref) : (root as any);
    const rootHtml = normalizeText((strippedRoot as any)?.innerHTML || '');
    const rootText = normalizeText((strippedRoot as any)?.innerText || '');
    const wechatGalleryHtml = buildWechatShareMediaGalleryHtml(baseHref);
    const htmlBody = rootHtml ? `${rootHtml}${wechatGalleryHtml}` : wechatGalleryHtml;
    const markdown =
      htmlToMarkdownTurndown(htmlBody, baseHref) ||
      normalizeText([rootText, wechatOnlyUrls.join('\n')].filter(Boolean).join('\n\n'));
    return {
      title: normalizeText(document.title || '') || 'WeChat Share Media',
      author: '',
      publishedAt: '',
      excerpt: '',
      contentHTML: buildHtml(htmlBody, ''),
      contentMarkdown: markdown,
      textContent: normalizeText([rootText, wechatOnlyUrls.join('\n')].filter(Boolean).join('\n\n')),
    };
  }

  const pickedRoot = pickRoot() as Element | null;
  const root = narrowFallbackRoot(pickedRoot);
  debugArticleExtract('fallback-root', {
    url: baseHref,
    pickedRoot: summarizeElementForDebug(pickedRoot),
    narrowedRoot: summarizeElementForDebug(root),
  });
  if (!root) return null;
  const title =
    normalizeText(document.title || '') || readMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]']);
  const author = readMeta([
    "meta[name='author']",
    "meta[property='article:author']",
    "meta[property='og:article:author']",
  ]);

  const text = readElementText(root as any);
  const htmlBody = normalizeText((root as any)?.innerHTML || '');
  if (!text && !htmlBody) return null;

  // Prefer DOM HTML when available so headings/lists/links survive markdown conversion.
  const fallbackHtml = buildHtml(htmlBody, text);
  const markdown = htmlToMarkdownTurndown(fallbackHtml, baseHref) || normalizeText(text);
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
    const text = root ? readElementText(root as any) : '';
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

async function waitForSiteHydrated() {
  await waitForWechatShareMediaHydrated();
  await waitForXiaohongshuNoteHydrated();
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

function appendHtmlBeforeBody(contentHTML: string, addition: string) {
  return contentHTML.replace(/<\/body>\s*<\/html>\s*$/i, `${addition}</body></html>`);
}

function extractBySiteSpecs(baseHref: string, includeXiaohongshuComments: boolean) {
  for (const spec of ARTICLE_FETCH_SITE_SPECS) {
    const payload = extractBySiteSpec(spec, baseHref);
    if (!payload) continue;
    if (spec.id === 'xiaohongshu_note' && includeXiaohongshuComments) {
      const comments = extractXiaohongshuComments();
      if (comments) {
        return {
          ...payload,
          contentHTML: appendHtmlBeforeBody(payload.contentHTML, comments.contentHTML),
          textContent: normalizeText([payload.textContent, comments.textContent].filter(Boolean).join('\n\n')),
        };
      }
    }
    return payload;
  }
  return null;
}

function extractWechatRichMediaArticle(baseHref: string) {
  const hostname = String(location.hostname || '').toLowerCase();
  if (hostname !== 'mp.weixin.qq.com') return null;

  const root = document.querySelector('#js_content') as any;
  if (!root) return null;

  const title =
    normalizeText((document.querySelector('#activity-name') as any)?.textContent || '') ||
    normalizeText((document.querySelector('.rich_media_title') as any)?.textContent || '') ||
    normalizeText(document.title || '') ||
    readMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]']);
  const author =
    normalizeText((document.querySelector('#js_name') as any)?.textContent || '') ||
    readMeta(["meta[name='author']", "meta[property='article:author']", "meta[property='og:article:author']"]);
  const publishedAt =
    normalizeText((document.querySelector('#publish_time') as any)?.textContent || '') ||
    readMeta(["meta[property='article:published_time']", "meta[name='publish_date']", "meta[name='pubdate']"]);

  const strippedRoot = normalizeWechatRichMediaContent(root, baseHref);
  const htmlBody = normalizeText((strippedRoot as any).innerHTML || '');
  const textContent = normalizeText((strippedRoot as any).innerText || (strippedRoot as any).textContent || '');
  if (!htmlBody && !textContent) return null;

  const wechatGalleryHtml = buildWechatShareMediaGalleryHtml(baseHref);
  const contentWithWechatGallery = wechatGalleryHtml ? `${htmlBody}${wechatGalleryHtml}` : htmlBody;

  return {
    title,
    author,
    publishedAt,
    excerpt: '',
    contentHTML: buildHtml(contentWithWechatGallery, textContent),
    textContent,
  };
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
  const htmlBody = normalizeText(content) || (text ? `<p>${escapeHtml(text)}</p>` : '');
  const contentWithWechatGallery = wechatGalleryHtml ? `${htmlBody}${wechatGalleryHtml}` : htmlBody;
  const markdownWithWechatGallery = htmlToMarkdownTurndown(contentWithWechatGallery, baseHref) || normalizeText(text);

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
  await waitForSiteHydrated();

  prepareWechatRichMediaDom();

  const sitePayload = extractBySiteSpecs(baseHref, options.includeXiaohongshuComments === true);
  if (sitePayload) {
    const markdown =
      htmlToMarkdownTurndown(sitePayload.contentHTML, baseHref) || normalizeText(sitePayload.textContent);
    return withDiscourseOpWarning(
      {
        ...sitePayload,
        contentMarkdown: markdown,
      },
      false,
    );
  }

  const wechatRichMedia = extractWechatRichMediaArticle(baseHref);
  if (wechatRichMedia) {
    const markdown =
      htmlToMarkdownTurndown(wechatRichMedia.contentHTML, baseHref) || normalizeText(wechatRichMedia.textContent);
    return withDiscourseOpWarning(
      {
        ...wechatRichMedia,
        contentMarkdown: markdown,
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
  const pickedRoot = pickRoot() as Element | null;
  const rootTextLen = readElementText(pickedRoot as any).length;
  debugArticleExtract('picked-root', {
    url: baseHref,
    root: summarizeElementForDebug(pickedRoot),
    rootTextLen,
    readyState: normalizeText(document.readyState || ''),
  });

  const defuddle = isWechatShareMediaPage() ? null : extractByDefuddle(baseHref);
  if (defuddle) {
    const candidateTextLen = normalizeText(defuddle.textContent || '').length;
    const rejectDefuddle =
      shouldTreatExtractionAsPartial(candidateTextLen, rootTextLen) ||
      shouldRejectDefuddleMicroCandidate(candidateTextLen, rootTextLen);
    debugArticleExtract('defuddle-result', {
      url: baseHref,
      candidateTextLen,
      title: normalizeText(defuddle.title || ''),
      textPreview: normalizeText(defuddle.textContent || '').slice(0, 200),
      accepted: !rejectDefuddle,
      rejectDefuddle,
      rootTextLen,
    });
    if (rejectDefuddle) {
      console.info('[ArticleExtract] defuddle extraction looks partial, continue with other strategies', {
        url: baseHref,
        candidateTextLen,
        rootTextLen,
      });
    } else {
      const markdown = htmlToMarkdownTurndown(defuddle.contentHTML, baseHref) || normalizeText(defuddle.textContent);
      return withDiscourseOpWarning(
        {
          ...defuddle,
          contentMarkdown: markdown,
        },
        discourseOpMissingOnCurrentPage,
      );
    }
  }

  const readability = extractByReadability(baseHref);
  if (readability) {
    const readabilityTextLen = normalizeText(readability.textContent || '').length;
    const rejectReadability = shouldRejectReadabilityCandidate(readability.textContent, rootTextLen);
    debugArticleExtract('readability-result', {
      url: baseHref,
      candidateTextLen: readabilityTextLen,
      title: normalizeText(readability.title || ''),
      textPreview: normalizeText(readability.textContent || '').slice(0, 200),
      rejectReadability,
      rootTextLen,
    });
    if (rejectReadability) {
      console.info('[ArticleExtract] readability extraction looks partial, continue with fallback', {
        url: baseHref,
        candidateTextLen: readabilityTextLen,
        rootTextLen,
      });
    } else {
      debugArticleExtract('final-result', {
        url: baseHref,
        strategy: 'readability',
        textLen: readabilityTextLen,
        title: normalizeText(readability.title || ''),
        textPreview: normalizeText(readability.textContent || '').slice(0, 200),
      });
      return withDiscourseOpWarning(
        {
          ...readability,
        },
        discourseOpMissingOnCurrentPage,
      );
    }
  }

  const fallback = fallbackExtract(baseHref);
  if (fallback) {
    debugArticleExtract('final-result', {
      url: baseHref,
      strategy: 'fallback',
      textLen: normalizeText(fallback.textContent || '').length,
      title: normalizeText(fallback.title || ''),
      textPreview: normalizeText(fallback.textContent || '').slice(0, 200),
    });
    return withDiscourseOpWarning(
      {
        ...fallback,
      },
      discourseOpMissingOnCurrentPage,
    );
  }

  throw new Error('No article content detected');
}
