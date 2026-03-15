import MarkdownIt from 'markdown-it';
import katex from 'katex';
import texmath from 'markdown-it-texmath';
import linkAttributes from 'markdown-it-link-attributes';

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
};

export function createMarkdownRenderer(options: MarkdownRendererOptions = {}) {
  const openLinksInNewTab = options.openLinksInNewTab ?? true;
  const renderMath = options.renderMath ?? true;
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

  function parseSyncnosAssetId(url: unknown): number | null {
    const text = String(url || '').trim();
    const matched = /^syncnos-asset:\/\/(\d+)$/i.exec(text);
    if (!matched) return null;
    const id = Number(matched[1]);
    if (!Number.isFinite(id) || id <= 0) return null;
    return id;
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

  try {
    inst.enable(['table']);
  } catch (_e) {
    // ignore
  }

  if (renderMath) {
    inst.use(texmath as any, {
      engine: katex as any,
      delimiters: 'dollars',
      katexOptions: {
        throwOnError: false,
        strict: 'ignore',
      },
    });
  }

  const defaultImageRender =
    inst.renderer.rules.image ||
    ((tokens, idx, opts, env, self) => {
      return self.renderToken(tokens, idx, opts);
    });

  inst.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const src = token && typeof token.attrGet === 'function' ? String(token.attrGet('src') || '') : '';
    const alt = token && typeof token.content === 'string' ? token.content : '';

    const safeSrc = String(src || '').trim();
    if (!safeSrc) return defaultImageRender(tokens, idx, opts, env, self);

    const escapedAlt = inst.utils.escapeHtml(String(alt || ''));
    const titleRaw = token && typeof token.attrGet === 'function' ? String(token.attrGet('title') || '') : '';
    const titleAttr = titleRaw ? ` title="${inst.utils.escapeHtml(titleRaw)}"` : '';
    const assetId = parseSyncnosAssetId(safeSrc);
    if (assetId) {
      return `<img src="about:blank" alt="${escapedAlt}" data-syncnos-asset-id="${assetId}"${titleAttr}>`;
    }

    const escapedSrc = inst.utils.escapeHtml(safeSrc);

    const img = `<img src="${escapedSrc}" alt="${escapedAlt}"${titleAttr}>`;

    if (!isHttpUrl(safeSrc) || isDataImageUrl(safeSrc)) return img;

    const linkText = inst.utils.escapeHtml(sanitizeUrlForDisplay(safeSrc));
    const a = `<a href="${escapedSrc}" target="_blank" rel="noreferrer noopener">${linkText || 'Image link'}</a>`;
    return `<span class="syncnos-md-image">${img}<br><span class="syncnos-md-image-link">${a}</span></span>`;
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
