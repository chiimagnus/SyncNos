import type { ArticleFetchSiteSpec } from '@collectors/web/article-fetch-sites/site-spec';
import { normalizeText, sanitizeSiteImageUrl } from '@collectors/web/article-extract/url';

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dedupeUrls(urls: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const value = String(url || '').trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function buildMarkdownImageBlocks(urls: string[]) {
  const unique = dedupeUrls(urls);
  if (!unique.length) return '';
  const lines: string[] = [];
  for (const url of unique) lines.push(`![](<${url}>)`, '');
  return normalizeText(lines.join('\n'));
}

function buildHtmlImageBlocks(urls: string[]) {
  const unique = dedupeUrls(urls);
  if (!unique.length) return '';
  return unique
    .map(
      (url) =>
        `<p data-syncnos-origin="image-block"><img src="${escapeHtml(url)}" alt="" loading="lazy" style="max-width:100%;height:auto;display:block;" /></p>`,
    )
    .join('');
}

function renderPlainTextAsHtml(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return '';
  const lines = normalized.split('\n').map((line) => normalizeText(line));
  return lines
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

function pickTextFromNode(node: any, prefer: unknown) {
  if (!node) return '';
  const mode = String(prefer || 'innerText').trim();
  if (mode === 'textContent') return normalizeText(node.textContent || '');
  return normalizeText(node.innerText || node.textContent || '');
}

function extractUrlsFromStyle(value: unknown): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const urls: string[] = [];
  const re = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/gi;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(raw)) != null) {
    const url = String(match[1] || match[2] || match[3] || '').trim();
    if (url) urls.push(url);
  }
  return urls;
}

function urlAllowed(spec: ArticleFetchSiteSpec, url: string): boolean {
  const allow = Array.isArray(spec.imageUrlAllowList) ? spec.imageUrlAllowList.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const block = Array.isArray(spec.imageUrlBlockList) ? spec.imageUrlBlockList.map((x) => String(x || '').trim()).filter(Boolean) : [];

  if (allow.length && !allow.some((pattern) => url.includes(pattern))) return false;
  if (block.length && block.some((pattern) => url.includes(pattern))) return false;
  return true;
}

function selectTitle(spec: ArticleFetchSiteSpec, root: Element, text: string) {
  const selectorTitle = spec.titleSelector ? normalizeText((root.querySelector(spec.titleSelector) as any)?.textContent || '') : '';
  if (selectorTitle) return selectorTitle;

  const metaTitle = normalizeText(
    (document.querySelector('meta[property="og:title"]') as any)?.getAttribute?.('content') ||
      (document.querySelector('meta[name="twitter:title"]') as any)?.getAttribute?.('content') ||
      (document.querySelector('meta[property="title"]') as any)?.getAttribute?.('content') ||
      '',
  );
  const documentTitle = normalizeText(document.title || '');
  const order = Array.isArray(spec.titleFallbackOrder) && spec.titleFallbackOrder.length ? spec.titleFallbackOrder : ['meta', 'document'];
  for (const token of order) {
    if (token === 'meta' && metaTitle) return metaTitle;
    if (token === 'document' && documentTitle) return documentTitle;
  }
  if (text) return text.length > 64 ? `${text.slice(0, 64)}…` : text;
  return '';
}

export function extractBySiteSpec(spec: ArticleFetchSiteSpec, baseHref: string) {
  const root = document.querySelector(spec.rootSelector);
  if (!root) return null;

  const author =
    (spec.authorSelector ? normalizeText((root.querySelector(spec.authorSelector) as any)?.textContent || '') : '') ||
    normalizeText(
      (document.querySelector("meta[name='author']") as any)?.getAttribute?.('content') ||
        (document.querySelector("meta[property='article:author']") as any)?.getAttribute?.('content') ||
        (document.querySelector("meta[property='og:article:author']") as any)?.getAttribute?.('content') ||
        '',
    );

  const publishedAt =
    (spec.publishedAtSelector ? normalizeText((root.querySelector(spec.publishedAtSelector) as any)?.textContent || '') : '') ||
    normalizeText(
      (document.querySelector("meta[property='article:published_time']") as any)?.getAttribute?.('content') ||
        (document.querySelector("meta[name='publish_date']") as any)?.getAttribute?.('content') ||
        (document.querySelector("meta[name='pubdate']") as any)?.getAttribute?.('content') ||
        '',
    );

  const text = spec.textSelector ? pickTextFromNode(root.querySelector(spec.textSelector), spec.textPrefer) : '';

  const urls: string[] = [];
  if (spec.imageSelector) {
    const images = Array.from(root.querySelectorAll(spec.imageSelector));
    for (const img of images) {
      const el = img as any;
      let src = '';
      const attrs = Array.isArray(spec.imageSrcAttributes) ? spec.imageSrcAttributes : [];
      for (const attr of attrs) {
        const value = el?.getAttribute?.(String(attr || '').trim()) || '';
        if (value) {
          src = value;
          break;
        }
      }
      if (!src) src = el?.currentSrc || el?.src || '';
      const url = sanitizeSiteImageUrl(src, baseHref, String(spec.imageSanitizer || 'none'));
      if (url && urlAllowed(spec, url)) urls.push(url);
    }
  }
  if (Array.isArray(spec.imageStyleSelectors) && spec.imageStyleSelectors.length) {
    for (const selector of spec.imageStyleSelectors) {
      const safeSelector = String(selector || '').trim();
      if (!safeSelector) continue;
      const nodes = Array.from(root.querySelectorAll(safeSelector));
      for (const node of nodes) {
        const el = node as any;
        const styleRaw =
          (typeof el?.getAttribute === 'function' ? el.getAttribute('style') : '') ||
          (el?.style?.backgroundImage ? String(el.style.backgroundImage) : '') ||
          '';
        const extracted = extractUrlsFromStyle(styleRaw);
        for (const candidate of extracted) {
          const url = sanitizeSiteImageUrl(candidate, baseHref, String(spec.imageSanitizer || 'none'));
          if (url && urlAllowed(spec, url)) urls.push(url);
        }
      }
    }
  }

  const title = selectTitle(spec, root, text);
  const imageMarkdown = buildMarkdownImageBlocks(urls);
  const imageHtml = buildHtmlImageBlocks(urls);
  const markdown = normalizeText([imageMarkdown, text].filter(Boolean).join('\n\n'));
  const textContent = text || dedupeUrls(urls).join('\n');

  if (!markdown && !textContent) return null;
  const htmlBody = normalizeText([imageHtml, renderPlainTextAsHtml(text)].filter(Boolean).join(''));

  return {
    title,
    author,
    publishedAt,
    contentHTML: htmlBody ? `<html><body>${htmlBody}</body></html>` : `<html><body><p>${escapeHtml(textContent)}</p></body></html>`,
    contentMarkdown: markdown,
    textContent,
    excerpt: '',
  };
}
