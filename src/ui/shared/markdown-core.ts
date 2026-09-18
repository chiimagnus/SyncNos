import MarkdownIt from 'markdown-it';
import linkAttributes from 'markdown-it-link-attributes';
import { chatgptFileIdFromUrl, hasChatgptFileScheme } from '@services/shared/chatgpt-image-identity';
import { isSyncnosAssetUrl, parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';

const INTERNAL_IMAGE_PLACEHOLDER_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export type MarkdownRendererOptions = {
  /**
   * If true, rendered links will open in a new tab.
   * Defaults to true to keep popup/app behavior consistent.
   */
  openLinksInNewTab?: boolean;
  /**
   * If true, render `$...$` and `$$...$$` using KaTeX.
   * Defaults to true.
   */
  renderMath?: boolean;
  /**
   * If false, image tokens degrade to readable text/links without creating `<img>`.
   * Defaults to true.
   */
  renderImages?: boolean;
  /**
   * KaTeX output mode when a math runtime is active.
   * Defaults to KaTeX's normal HTML + MathML output.
   */
  mathOutput?: 'html' | 'mathml' | 'htmlAndMathml';
};

export type MarkdownMathRuntime = {
  texmathPlugin: unknown;
  katexEngine: {
    renderToString: (expression: string, options?: Record<string, unknown>) => string;
  };
};

const MATH_BLOCK_RE = /\$\$[\s\S]+?\$\$/;
const MATH_INLINE_RE = /(^|[^\\])\$(?!\$)[^$\n]+?\$(?!\$)/;

export function markdownLikelyContainsMath(markdown: unknown): boolean {
  const text = String(markdown || '');
  if (!text) return false;
  return MATH_BLOCK_RE.test(text) || MATH_INLINE_RE.test(text);
}

export function createMarkdownRenderer(options: MarkdownRendererOptions = {}, mathRuntime?: MarkdownMathRuntime) {
  const openLinksInNewTab = options.openLinksInNewTab ?? true;
  const renderMath = options.renderMath ?? true;
  const renderImages = options.renderImages ?? true;
  const mathOutput = options.mathOutput ?? 'htmlAndMathml';
  const inst = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
    typographer: false,
  });

  function isHttpUrl(url: unknown): boolean {
    const text = String(url || '').trim();
    return /^https?:\/\//i.test(text);
  }

  function isDataImageUrl(url: unknown): boolean {
    const text = String(url || '').trim();
    if (!text) return false;
    return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?(?:;base64)?,/i.test(text);
  }

  function sanitizeUrlForDisplay(url: unknown): string {
    const text = String(url || '').trim();
    if (!text) return '';
    try {
      const u = new URL(text);
      const keys: string[] = [];
      for (const [k] of u.searchParams.entries()) keys.push(k);
      const uniqueKeys = Array.from(new Set(keys));
      const q = uniqueKeys.length ? `?keys=${uniqueKeys.slice(0, 12).join(',')}` : '';
      return `${u.origin}${u.pathname}${q}`;
    } catch (_e) {
      return text.length > 160 ? `${text.slice(0, 157)}...` : text;
    }
  }

  if (renderMath) {
    if (mathRuntime) {
      inst.use(mathRuntime.texmathPlugin as any, {
        engine: mathRuntime.katexEngine as any,
        delimiters: 'dollars',
        katexOptions: {
          throwOnError: false,
          strict: 'ignore',
          output: mathOutput,
        },
      });
    }
  }

  const defaultImageRender =
    inst.renderer.rules.image ||
    ((tokens, idx, opts, env, self) => {
      return self.renderToken(tokens, idx, opts);
    });

  function renderExternalImageWithLink(img: string, href: string): string {
    const escapedHref = inst.utils.escapeHtml(href);
    const linkText = inst.utils.escapeHtml(sanitizeUrlForDisplay(href));
    const a = `<a href="${escapedHref}" target="_blank" rel="noreferrer noopener">${linkText || 'Image link'}</a>`;
    return `<span class="syncnos-md-image">${img}<br><span class="syncnos-md-image-link">${a}</span></span>`;
  }

  inst.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const src = token && typeof token.attrGet === 'function' ? String(token.attrGet('src') || '') : '';
    const alt = token && typeof token.content === 'string' ? token.content : '';

    const safeSrc = String(src || '').trim();
    if (!safeSrc) return renderImages ? defaultImageRender(tokens, idx, opts, env, self) : '';

    const escapedAlt = inst.utils.escapeHtml(String(alt || ''));
    if (!renderImages) {
      const label = String(alt || '').trim() || (isHttpUrl(safeSrc) ? sanitizeUrlForDisplay(safeSrc) : 'Image');
      const escapedLabel = inst.utils.escapeHtml(label);
      if (!isHttpUrl(safeSrc)) return `<span class="syncnos-md-image-text">${escapedLabel}</span>`;
      const escapedHref = inst.utils.escapeHtml(safeSrc);
      const linkAttrs = openLinksInNewTab ? ' target="_blank" rel="noreferrer noopener"' : '';
      return `<a class="syncnos-md-image-text" href="${escapedHref}"${linkAttrs}>${escapedLabel}</a>`;
    }
    const titleRaw = token && typeof token.attrGet === 'function' ? String(token.attrGet('title') || '') : '';
    const titleAttr = titleRaw ? ` title="${inst.utils.escapeHtml(titleRaw)}"` : '';
    const assetId = parseSyncnosAssetId(safeSrc);
    if (assetId) {
      const envMap = env && typeof env === 'object' ? (env as any).syncnosAssetSrcById : null;
      const resolved = envMap && (typeof envMap.get === 'function' ? envMap.get(assetId) : (envMap as any)[assetId]);
      const safeResolved = typeof resolved === 'string' ? resolved.trim() : '';
      const finalSrc = safeResolved || INTERNAL_IMAGE_PLACEHOLDER_SRC;
      const escapedFinal = inst.utils.escapeHtml(finalSrc);
      return `<img src="${escapedFinal}" alt="${escapedAlt}" data-syncnos-asset-id="${assetId}"${titleAttr}>`;
    }

    if (isSyncnosAssetUrl(safeSrc)) {
      const escapedPlaceholder = inst.utils.escapeHtml(INTERNAL_IMAGE_PLACEHOLDER_SRC);
      return `<img src="${escapedPlaceholder}" alt="${escapedAlt}"${titleAttr}>`;
    }

    const chatgptFileId = chatgptFileIdFromUrl(safeSrc);
    if (chatgptFileId) {
      const envMap = env && typeof env === 'object' ? (env as any).chatgptFileSrcById : null;
      const resolved =
        envMap && (typeof envMap.get === 'function' ? envMap.get(chatgptFileId) : (envMap as any)[chatgptFileId]);
      const safeResolved = typeof resolved === 'string' ? resolved.trim() : '';
      const finalSrc = safeResolved || INTERNAL_IMAGE_PLACEHOLDER_SRC;
      const img = `<img src="${inst.utils.escapeHtml(finalSrc)}" alt="${escapedAlt}" data-chatgpt-file-id="${inst.utils.escapeHtml(chatgptFileId)}"${titleAttr}>`;
      return safeResolved && isHttpUrl(safeResolved) ? renderExternalImageWithLink(img, safeResolved) : img;
    }

    if (hasChatgptFileScheme(safeSrc)) {
      const escapedPlaceholder = inst.utils.escapeHtml(INTERNAL_IMAGE_PLACEHOLDER_SRC);
      return `<img src="${escapedPlaceholder}" alt="${escapedAlt}"${titleAttr}>`;
    }

    const escapedSrc = inst.utils.escapeHtml(safeSrc);
    const img = `<img src="${escapedSrc}" alt="${escapedAlt}"${titleAttr}>`;

    if (!isHttpUrl(safeSrc) || isDataImageUrl(safeSrc)) return img;

    return renderExternalImageWithLink(img, safeSrc);
  };

  if (openLinksInNewTab) {
    inst.use(linkAttributes as any, {
      attrs: {
        target: '_blank',
        rel: 'noreferrer noopener',
      },
    });
  }

  return inst;
}
