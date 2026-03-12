import MarkdownIt from 'markdown-it';
import katex from 'katex';

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
    const sanitizeTeXForKatex = (tex: string): string => {
      return String(tex || '').replace(/□/g, '\\Box');
    };

    const renderKatex = (tex: string, displayMode: boolean): string => {
      const raw = sanitizeTeXForKatex(String(tex || '').trim());
      if (!raw) return '';
      try {
        return katex.renderToString(raw, { displayMode, throwOnError: false, strict: 'ignore' });
      } catch (_e) {
        return `<code>${inst.utils.escapeHtml(raw)}</code>`;
      }
    };

    inst.block.ruler.before('fence', 'syncnos_math_block', (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const firstLine = state.src.slice(start, max);
      const trimmed = firstLine.trim();
      if (!trimmed.startsWith('$$')) return false;

      // Single-line: $$...$$
      if (trimmed.length >= 4 && trimmed.endsWith('$$') && trimmed !== '$$') {
        if (silent) return true;
        const token = state.push('math_block', 'div', 0);
        token.block = true;
        token.content = trimmed.slice(2, -2).trim();
        token.map = [startLine, startLine + 1];
        state.line = startLine + 1;
        return true;
      }

      // Multi-line:
      // $$
      // ...
      // $$
      if (trimmed !== '$$') return false;
      let nextLine = startLine + 1;
      const lines: string[] = [];
      while (nextLine < endLine) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
        const lineMax = state.eMarks[nextLine];
        const lineText = state.src.slice(lineStart, lineMax);
        const lineTrim = lineText.trim();
        if (lineTrim === '$$') break;
        lines.push(lineText);
        nextLine += 1;
      }
      if (nextLine >= endLine) return false;
      if (silent) return true;

      const token = state.push('math_block', 'div', 0);
      token.block = true;
      token.content = lines.join('\n').trim();
      token.map = [startLine, nextLine + 1];
      state.line = nextLine + 1;
      return true;
    });

    inst.inline.ruler.before('escape', 'syncnos_math_inline', (state, silent) => {
      const pos = state.pos;
      const src = state.src;
      if (src.charCodeAt(pos) !== 0x24 /* $ */) return false;

      const isDouble = src.charCodeAt(pos + 1) === 0x24;
      const openerLen = isDouble ? 2 : 1;
      const closer = isDouble ? '$$' : '$';
      const start = pos + openerLen;

      // Reject whitespace right after opening delimiter for inline math.
      if (!isDouble) {
        const nextCh = src[start] || '';
        if (!nextCh || /\s/.test(nextCh)) return false;
      }

      let end = start;
      while (end < src.length) {
        end = src.indexOf(closer, end);
        if (end === -1) return false;
        // Ignore escaped \$.
        if (src[end - 1] === '\\') {
          end += 1;
          continue;
        }
        break;
      }

      const content = src.slice(start, end);
      if (!content.trim()) return false;
      if (!isDouble && /\s$/.test(content)) return false;
      if (content.includes('\n')) return false;

      if (silent) return true;

      const token = state.push('math_inline', 'span', 0);
      token.content = content.trim();
      (token as any).meta = { displayMode: isDouble };
      state.pos = end + openerLen;
      return true;
    });

    inst.renderer.rules.math_inline = (tokens, idx) => {
      const token: any = tokens[idx];
      const displayMode = !!(token && token.meta && token.meta.displayMode);
      return renderKatex(String(token.content || ''), displayMode);
    };

    inst.renderer.rules.math_block = (tokens, idx) => {
      const token: any = tokens[idx];
      const html = renderKatex(String(token.content || ''), true);
      if (!html) return '';
      return `<div class="syncnos-math-block">${html}</div>\n`;
    };
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
