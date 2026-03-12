import MarkdownIt from 'markdown-it';

export type MarkdownRendererOptions = {
  /**
   * If true, rendered links will open in a new tab.
   * Defaults to true to keep popup/app behavior consistent.
   */
  openLinksInNewTab?: boolean;
};

export function createMarkdownRenderer(options: MarkdownRendererOptions = {}) {
  const openLinksInNewTab = options.openLinksInNewTab ?? true;
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

  try {
    inst.enable(['table']);
  } catch (_e) {
    // ignore
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

    const escapedSrc = inst.utils.escapeHtml(safeSrc);
    const escapedAlt = inst.utils.escapeHtml(String(alt || ''));

    const titleRaw = token && typeof token.attrGet === 'function' ? String(token.attrGet('title') || '') : '';
    const titleAttr = titleRaw ? ` title="${inst.utils.escapeHtml(titleRaw)}"` : '';

    const img = `<img src="${escapedSrc}" alt="${escapedAlt}"${titleAttr}>`;

    if (!isHttpUrl(safeSrc) || isDataImageUrl(safeSrc)) return img;

    const linkText = inst.utils.escapeHtml(sanitizeUrlForDisplay(safeSrc));
    const a = `<a href="${escapedSrc}" target="_blank" rel="noreferrer noopener">${linkText || 'Image link'}</a>`;
    return `<span class="syncnos-md-image">${img}<br><span class="syncnos-md-image-link">${a}</span></span>`;
  };

  if (openLinksInNewTab) {
    const defaultRender =
      inst.renderer.rules.link_open ||
      ((tokens, idx, opts, _env, self) => {
        return self.renderToken(tokens, idx, opts);
      });

    inst.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
      const token = tokens[idx];
      if (token) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noreferrer noopener');
      }
      return defaultRender(tokens, idx, opts, env, self);
    };
  }

  return inst;
}
