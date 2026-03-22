import { normalizeText as normalizeTextShared } from '@services/shared/normalize.ts';
import { replaceMathElementsWithLatexText } from '@collectors/formula-utils.ts';

function normalizeMarkdown(markdown: any): any {
  const s = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lines = s.split('\n').map((l: any) => l.replace(/[ \t]+$/g, ''));
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeInline(markdown: any): any {
  return normalizeMarkdown(markdown).replace(/\n+/g, ' ').trim();
}

function normalizeText(value: any): any {
  const text = String(value || '');
  return normalizeTextShared(text);
}

function wrapInlineCode(text: any): any {
  const s = String(text || '');
  if (!s) return '``';
  const matches = s.match(/`+/g) || [];
  const maxTicks = matches.reduce((m: any, t: any) => Math.max(m, t.length), 0);
  const fence = '`'.repeat(Math.max(1, maxTicks + 1));
  return `${fence}${s}${fence}`;
}

function codeFenceDelimiter(content: any): any {
  const runs = String(content || '').match(/`+/g) || [];
  const longest = runs.reduce((max: any, s: any) => Math.max(max, s.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function normalizeCodeLanguage(raw: any): any {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  if (!value) return '';
  if (!/^[a-z0-9_+.-]{1,40}$/.test(value)) return '';
  if (value === 'text' || value === 'code') return '';
  return value;
}

function pickCodeLanguageFromClass(className: any): any {
  const raw = String(className || '');
  if (!raw) return '';
  const parts = raw.split(/\s+/).filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^(language|lang)-([a-z0-9_+.-]+)$/i);
    if (m && m[2]) {
      const language = normalizeCodeLanguage(m[2]);
      if (language) return language;
    }
  }
  return '';
}

function extractTextWithBreaks(node: any): any {
  if (!node) return '';
  const TEXT_NODE = typeof Node !== 'undefined' && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
  const ELEMENT_NODE = typeof Node !== 'undefined' && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

  function walk(n: any): any {
    if (!n) return '';
    if (n.nodeType === TEXT_NODE) return String(n.nodeValue || '');
    if (n.nodeType !== ELEMENT_NODE) return '';

    const tag = String(n.tagName || '').toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'script' || tag === 'style') return '';

    const children = n.childNodes ? Array.from(n.childNodes) : [];
    return children.map((child: any) => walk(child)).join('');
  }

  return walk(node).replace(/\r\n?/g, '\n');
}

function extractPreCodeText(preEl: any): any {
  if (!preEl) return '';
  const codeEl = preEl.querySelector ? preEl.querySelector('code') : null;
  if (codeEl) {
    return String(codeEl.textContent || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n+$/g, '');
  }
  return String(extractTextWithBreaks(preEl) || '').replace(/\n+$/g, '');
}

function detectCodeLanguage(preEl: any): any {
  if (!preEl || !preEl.closest) return '';
  const codeBlock = preEl.closest('.md-code-block');
  if (codeBlock && codeBlock.querySelector) {
    const label = codeBlock.querySelector(".d813de27, [class*='language']");
    const labelText = normalizeCodeLanguage(label && label.textContent ? label.textContent : '');
    if (labelText) return labelText;
  }

  const codeEl = preEl.querySelector ? preEl.querySelector('code') : null;
  const byClass = pickCodeLanguageFromClass(codeEl && codeEl.getAttribute ? codeEl.getAttribute('class') : '');
  if (byClass) return byClass;

  const nodes: any[] = preEl.querySelectorAll
    ? (Array.from(preEl.querySelectorAll('[data-language],[data-code-language],[class]')) as any[]).slice(0, 12)
    : [];
  for (const node of nodes) {
    if (!node || !node.getAttribute) continue;
    const dataLanguage = normalizeCodeLanguage(
      node.getAttribute('data-language') || node.getAttribute('data-code-language'),
    );
    if (dataLanguage) return dataLanguage;
    const className = String(node.getAttribute('class') || '');
    const m = className.match(/\blanguage-([a-z0-9_+.-]+)\b/i);
    if (m && m[1]) {
      const fromClass = normalizeCodeLanguage(m[1]);
      if (fromClass) return fromClass;
    }
  }
  return '';
}

function escapeTableCell(text: any): any {
  return String(text || '').replace(/\|/g, '\\|');
}

function removeNonContentNodes(container: any): any {
  if (!container || !container.querySelectorAll) return container;
  container.querySelectorAll('button, svg, path, textarea, input, select, option, script, style').forEach((el: any) => {
    try {
      el.remove();
    } catch (_e) {
      // ignore
    }
  });
  return container;
}

function getAssistantContentRoot(wrapper: any): any {
  if (!wrapper || !wrapper.querySelector) return wrapper;
  return wrapper.querySelector('.ds-markdown') || wrapper;
}

function sanitizeAssistantClone(wrapper: any): any {
  const root = getAssistantContentRoot(wrapper);
  if (!root || !root.cloneNode) return null;
  try {
    const cloned = root.cloneNode(true);
    replaceMathElementsWithLatexText(cloned);
    removeNonContentNodes(cloned);
    return cloned;
  } catch (_e) {
    return null;
  }
}

function extractTextFromSanitizedClone(clone: any): any {
  if (!clone) return '';
  const inner = typeof clone.innerText === 'string' ? clone.innerText : '';
  if (inner && inner.trim()) return inner;

  const blockTags = new Set([
    'P',
    'DIV',
    'LI',
    'UL',
    'OL',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'BLOCKQUOTE',
    'PRE',
    'SECTION',
    'ARTICLE',
    'TABLE',
    'TR',
  ]);
  const parts: any[] = [];
  const TEXT_NODE = typeof Node !== 'undefined' && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
  const ELEMENT_NODE = typeof Node !== 'undefined' && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

  function walk(node: any): any {
    if (!node) return;
    const t = node.nodeType;
    if (t === TEXT_NODE) {
      const v = node.nodeValue ? String(node.nodeValue) : '';
      if (v) parts.push(v);
      return;
    }
    if (t !== ELEMENT_NODE) return;

    const tag = node.tagName ? String(node.tagName).toUpperCase() : '';
    if (tag === 'BR') {
      parts.push('\n');
      return;
    }

    if (tag === 'PRE') {
      const codeText = extractPreCodeText(node);
      if (codeText) parts.push(codeText);
      parts.push('\n\n');
      return;
    }

    const children = node.childNodes ? Array.from(node.childNodes) : [];
    for (const c of children) walk(c);
    if (blockTags.has(tag)) parts.push('\n\n');
  }

  walk(clone);
  return parts.join('');
}

function htmlToMarkdown(root: any): any {
  if (!root) return '';
  const TEXT_NODE = typeof Node !== 'undefined' && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
  const ELEMENT_NODE = typeof Node !== 'undefined' && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

  function renderChildren(el: any, ctx: any): any {
    const out = [];
    const kids = el && el.childNodes ? Array.from(el.childNodes) : [];
    for (const c of kids) out.push(renderNode(c, ctx));
    return out.join('');
  }

  function renderListItem(li: any, marker: any, depth: any, ctx: any): any {
    const indent = '  '.repeat(Math.max(0, depth));
    const continuationIndent = indent + ' '.repeat(marker.length + 1);

    const contentClone = li.cloneNode ? li.cloneNode(true) : null;
    if (contentClone && contentClone.childNodes) {
      const toRemove: any[] = [];
      for (const child of Array.from(contentClone.childNodes) as any[]) {
        if (!child || !child.tagName) continue;
        const tag = String(child.tagName || '').toLowerCase();
        if (tag === 'ul' || tag === 'ol') toRemove.push(child);
      }
      for (const n of toRemove) {
        try {
          n.remove();
        } catch (_e) {
          // ignore
        }
      }
    }

    const body = normalizeMarkdown(renderChildren(contentClone || li, ctx)).replace(/\n{2,}/g, '\n');
    const lines = body ? body.split('\n').filter((l: any) => l.length) : [];
    const out = [];
    if (lines.length) {
      out.push(`${indent}${marker} ${lines[0]}`);
      for (const line of lines.slice(1)) out.push(`${continuationIndent}${line}`);
    } else {
      out.push(`${indent}${marker}`);
    }

    const nestedLists: any[] = [];
    if (li && li.childNodes) {
      for (const child of Array.from(li.childNodes) as any[]) {
        if (!child || !child.tagName) continue;
        const tag = String(child.tagName || '').toLowerCase();
        if (tag === 'ul' || tag === 'ol') nestedLists.push(child);
      }
    }
    for (const nested of nestedLists) {
      const nestedMarkdown = renderList(nested, String(nested.tagName || '').toLowerCase() === 'ol', {
        ...ctx,
        listDepth: depth + 1,
      }).trimEnd();
      if (nestedMarkdown) out.push(nestedMarkdown);
    }

    return out.join('\n');
  }

  function renderList(listEl: any, ordered: any, ctx: any): any {
    const depth = ctx && Number.isFinite(ctx.listDepth) ? ctx.listDepth : 0;
    const startValue = Number.parseInt(String(listEl.getAttribute ? listEl.getAttribute('start') || '' : ''), 10);
    const hasStart = Number.isFinite(startValue);

    const items: any[] = [];
    const children: any[] = listEl && listEl.children ? (Array.from(listEl.children) as any[]) : [];
    let orderedIndex = hasStart ? startValue : 1;
    for (const child of children) {
      if (!child || String(child.tagName || '').toLowerCase() !== 'li') continue;
      const marker = ordered ? `${orderedIndex}.` : '-';
      items.push(renderListItem(child, marker, depth, { ...ctx, listDepth: depth }));
      if (ordered) orderedIndex += 1;
    }
    return items.join('\n') + (items.length ? '\n\n' : '');
  }

  function renderBlockquote(el: any, ctx: any): any {
    const raw = normalizeMarkdown(renderChildren(el, ctx));
    if (!raw) return '';
    const lines = raw.split('\n');
    const quoted = lines
      .map((l: any) => {
        const line = String(l || '').replace(/^\s+/g, '');
        return line ? `> ${line}` : '>';
      })
      .join('\n');
    return `${quoted}\n\n`;
  }

  function renderTable(tableEl: any, ctx: any): any {
    if (!tableEl || !tableEl.querySelectorAll) return '';
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    if (!rows.length) return '';

    const matrix = rows.map((tr: any) => {
      const cells = Array.from(tr.children || []).filter((c: any) => {
        const tag = c && c.tagName ? String(c.tagName).toLowerCase() : '';
        return tag === 'th' || tag === 'td';
      });
      return cells.map((cell: any) => escapeTableCell(normalizeInline(renderChildren(cell, ctx))));
    });

    const colCount = Math.max(0, ...matrix.map((r: any) => r.length));
    if (!colCount || !matrix.length) return '';

    const out = [];
    const header = matrix[0].concat(Array(Math.max(0, colCount - matrix[0].length)).fill(''));
    out.push(`| ${header.join(' | ')} |`);
    out.push(`| ${Array(colCount).fill('---').join(' | ')} |`);
    for (const row of matrix.slice(1)) {
      const padded = row.concat(Array(Math.max(0, colCount - row.length)).fill(''));
      out.push(`| ${padded.join(' | ')} |`);
    }
    return `${out.join('\n')}\n\n`;
  }

  function renderNode(node: any, ctx: any): any {
    if (!node) return '';
    if (node.nodeType === TEXT_NODE) {
      const raw = node.nodeValue ? String(node.nodeValue) : '';
      if (!raw) return '';
      if (ctx && ctx.preserveWhitespace) return raw;
      return raw.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== ELEMENT_NODE) return '';

    const tag = node.tagName ? String(node.tagName).toLowerCase() : '';
    if (!tag) return renderChildren(node, ctx);

    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path' || tag === 'button') return '';
    const classText = typeof node.getAttribute === 'function' ? String(node.getAttribute('class') || '') : '';
    if (/md-code-block-banner|code-info-button-text|md-code-block-banner-wrap/.test(classText)) return '';

    if (tag === 'pre') {
      const text = extractPreCodeText(node);
      if (!text.trim()) return '';
      const lang = detectCodeLanguage(node);
      const fence = codeFenceDelimiter(text);
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    }

    if (tag === 'code') return wrapInlineCode(String(node.textContent || ''));
    if (tag === 'strong' || tag === 'b') return `**${renderChildren(node, ctx)}**`;
    if (tag === 'em' || tag === 'i') return `*${renderChildren(node, ctx)}*`;
    if (tag === 'del' || tag === 's') return `~~${renderChildren(node, ctx)}~~`;

    if (tag === 'a') {
      const href = node.getAttribute ? String(node.getAttribute('href') || '') : '';
      const text = normalizeMarkdown(renderChildren(node, ctx));
      if (href && /^https?:\/\//i.test(href)) return `[${text || href}](${href})`;
      return text;
    }

    if (tag === 'img') {
      const src = node.getAttribute ? String(node.getAttribute('src') || '').trim() : '';
      if (/^https?:\/\//i.test(src)) return `![](${src})`;
      return '';
    }

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      const text = normalizeMarkdown(renderChildren(node, ctx));
      if (!text) return '';
      return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${text}\n\n`;
    }

    if (tag === 'table') return renderTable(node, ctx);
    if (tag === 'ul') return renderList(node, false, ctx);
    if (tag === 'ol') return renderList(node, true, ctx);
    if (tag === 'blockquote') return renderBlockquote(node, ctx);

    if (tag === 'p') {
      const text = normalizeMarkdown(renderChildren(node, ctx));
      return text ? `${text}\n\n` : '';
    }

    if (tag === 'li') {
      const text = normalizeMarkdown(renderChildren(node, ctx));
      return text ? `${text}\n` : '';
    }

    const rendered = renderChildren(node, ctx);
    if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'span') return rendered;
    return rendered;
  }

  return normalizeMarkdown(renderNode(root, { listDepth: 0 }));
}

function extractAssistantMarkdown(wrapper: any): any {
  const cloned = sanitizeAssistantClone(wrapper);
  if (!cloned) return '';
  return htmlToMarkdown(cloned) || '';
}

function extractAssistantText(wrapper: any): any {
  const cloned = sanitizeAssistantClone(wrapper);
  if (!cloned) return '';
  return normalizeText(extractTextFromSanitizedClone(cloned));
}

const api = {
  removeNonContentNodes,
  normalizeMarkdown,
  extractTextFromSanitizedClone,
  htmlToMarkdown,
  extractAssistantMarkdown,
  extractAssistantText,
};

export default api;
