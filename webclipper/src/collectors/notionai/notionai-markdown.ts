function texFromKatex(el: any): any {
  if (!el || !el.querySelector) return '';
  const ann = el.querySelector('annotation[encoding="application/x-tex"]');
  const raw = ann ? ann.textContent || '' : '';
  return String(raw || '').trim();
}

function wrapInlineCode(content: any): any {
  const raw = String(content || '');
  const delimiter = raw.includes('`') ? '``' : '`';
  const cleaned = raw.replace(/\n+/g, ' ').trim();
  return `${delimiter}${cleaned}${delimiter}`;
}

function elementStyleString(el: any): any {
  if (!el || !el.getAttribute) return '';
  return String(el.getAttribute('style') || '');
}

function isBoldEl(el: any): any {
  if (!el) return false;
  const tag = el.tagName ? String(el.tagName).toLowerCase() : '';
  if (tag === 'strong' || tag === 'b') return true;
  const style = elementStyleString(el);
  return /font-weight\s*:\s*(600|700|800|900)/i.test(style);
}

function isItalicEl(el: any): any {
  if (!el) return false;
  const tag = el.tagName ? String(el.tagName).toLowerCase() : '';
  if (tag === 'em' || tag === 'i') return true;
  const style = elementStyleString(el);
  return /font-style\s*:\s*italic/i.test(style);
}

function isStrikeEl(el: any): any {
  if (!el) return false;
  const tag = el.tagName ? String(el.tagName).toLowerCase() : '';
  if (tag === 's' || tag === 'del') return true;
  const style = elementStyleString(el);
  return /text-decoration[^;]*line-through/i.test(style);
}

function normalizeMarkdownText(value: any): any {
  // Remove zero-width spaces that Notion sometimes injects.
  return String(value || '').replace(/\u200b/g, '');
}

function notionWorkspaceSlugFromPath(pathname: any): string {
  const segments = String(pathname || '')
    .split('/')
    .map((segment) => String(segment || '').trim())
    .filter(Boolean);
  const first = segments[0] || '';
  if (!first) return '';
  if (first === 'chat' || /^[0-9a-f]{32}$/i.test(first)) return '';
  return first;
}

function resolveNotionHref(href: any): string {
  const raw = String(href || '').trim();
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      url.hash = '';
      return url.toString();
    } catch (_e) {
      return raw;
    }
  }

  const baseHref = String((typeof location !== 'undefined' && location && location.href) || '').trim();
  if (!baseHref) return '';

  try {
    const url = new URL(raw, baseHref);
    const pathname = String(url.pathname || '');
    const pageIdMatch = pathname.match(/^\/(?:([0-9a-f]{32})|([^/?#]+)\/([0-9a-f]{32}))(?:$|[/?#])/i);
    if (pageIdMatch && /(^|\.)notion\.so$/i.test(url.hostname)) {
      const workspaceSlug = notionWorkspaceSlugFromPath(
        (typeof location !== 'undefined' && location && location.pathname) || '',
      );
      if (workspaceSlug) {
        const pageId = String(pageIdMatch[1] || pageIdMatch[3] || '').toLowerCase();
        if (pageId) {
          url.pathname = `/${workspaceSlug}/${pageId}`;
          url.search = '';
          url.hash = '';
          return url.toString();
        }
      }
    }

    url.hash = '';
    return url.toString();
  } catch (_e) {
    return raw;
  }
}

function nodeToMarkdown(node: any): any {
  if (!node) return '';
  const TEXT_NODE = typeof Node !== 'undefined' && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
  const ELEMENT_NODE = typeof Node !== 'undefined' && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;
  if (node.nodeType === TEXT_NODE) return normalizeMarkdownText(node.nodeValue || '');
  if (node.nodeType !== ELEMENT_NODE) return '';

  const el = node;
  const tag = el.tagName ? String(el.tagName).toLowerCase() : '';

  if (tag === 'br') return '\n';

  if (el.classList && el.classList.contains('notion-inline-code-container')) {
    return wrapInlineCode(el.textContent || '');
  }

  if (el.classList && (el.classList.contains('katex') || el.classList.contains('katex-display'))) {
    const tex = texFromKatex(el);
    return tex ? `$${tex}$` : normalizeMarkdownText(el.textContent || '');
  }

  if (tag === 'a') {
    const href = resolveNotionHref(el.getAttribute ? el.getAttribute('href') : '');
    const text = childrenToMarkdown(el);
    if (/^https?:\/\//i.test(href)) return `[${text || href}](${href})`;
    return text;
  }

  if (tag === 'code') {
    return wrapInlineCode(el.textContent || '');
  }

  const inner = childrenToMarkdown(el);
  if (!inner) return '';

  // Apply emphasis wrappers (best-effort). Avoid wrapping whitespace-only.
  const content = inner;
  if (!content.trim()) return content;

  const strike = isStrikeEl(el);
  const bold = isBoldEl(el);
  const italic = isItalicEl(el);

  let out = content;
  if (strike) out = `~~${out}~~`;
  if (bold) out = `**${out}**`;
  if (italic) out = `*${out}*`;
  return out;
}

function childrenToMarkdown(el: any): any {
  const parts = [];
  const nodes = el && el.childNodes ? Array.from(el.childNodes) : [];
  for (const n of nodes) {
    const md = nodeToMarkdown(n);
    if (md) parts.push(md);
  }
  return parts.join('');
}

function leafToMarkdown(leaf: any): any {
  if (!leaf) return '';
  const raw = childrenToMarkdown(leaf);
  // Keep line breaks, but trim excessive leading/trailing whitespace.
  return normalizeMarkdownText(raw)
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function getBlockTypeName(block: any): any {
  if (!block || !block.classList) return '';
  for (const c of Array.from(block.classList) as any[]) {
    if (!c || !c.startsWith('notion-') || !c.endsWith('-block')) continue;
    return c.slice('notion-'.length, -'-block'.length);
  }
  return '';
}

function isTopLevelBlock(block: any, scope: any): any {
  let p = block && block.parentElement ? block.parentElement : null;
  while (p && p !== scope) {
    if (p.getAttribute && p.getAttribute('data-block-id')) return false;
    p = p.parentElement;
  }
  return true;
}

function blockLeaf(block: any): any {
  if (!block || !block.querySelector) return null;
  return (
    block.querySelector("[data-content-editable-leaf='true']") ||
    block.querySelector('[data-content-editable-leaf="true"]') ||
    null
  );
}

function isListType(type: any): any {
  return type === 'bulleted_list' || type === 'numbered_list' || type === 'to_do_list';
}

function directChildBlocks(block: any): any {
  if (!block || !block.querySelectorAll) return [];
  const all: any[] = Array.from(block.querySelectorAll('div[data-block-id]')) as any[];
  return all.filter((child: any) => {
    if (!child || child === block) return false;
    const parentBlock = child.parentElement ? child.parentElement.closest('div[data-block-id]') : null;
    return parentBlock === block;
  });
}

function numberedListMarker(block: any): any {
  if (!block || !block.querySelector) return '1.';
  const label = block.querySelector('.notion-list-item-box-left .pseudoBefore');
  const fromText = String((label && label.textContent) || '').trim();
  const textMatch = fromText.match(/^(\d+)[.)]?$/);
  if (textMatch) return `${textMatch[1]}.`;

  const style = elementStyleString(label);
  const styleMatch = style.match(/--pseudoBefore--content:\s*["']?(\d+)\.?["']?/i);
  if (styleMatch) return `${styleMatch[1]}.`;

  return '1.';
}

function listItemMarker(block: any, type: any): any {
  if (type === 'bulleted_list') return '-';
  if (type === 'numbered_list') return numberedListMarker(block);
  if (type === 'to_do_list') {
    const checked = !!block.querySelector('[role="checkbox"][aria-checked="true"]');
    return checked ? '- [x]' : '- [ ]';
  }
  return '-';
}

function renderListItem(block: any, depth: any): any {
  const type = getBlockTypeName(block);
  const marker = listItemMarker(block, type);
  const indent = '  '.repeat(Math.max(0, depth));
  const continuationIndent = indent + ' '.repeat(marker.length + 1);

  const leaf = blockLeaf(block);
  const text = leafToMarkdown(leaf);
  const textLines = text ? text.split('\n') : [];

  const lines = [];
  if (textLines.length) {
    lines.push(`${indent}${marker} ${textLines[0]}`);
    for (const line of textLines.slice(1)) lines.push(`${continuationIndent}${line}`);
  } else {
    lines.push(`${indent}${marker}`);
  }

  const children = directChildBlocks(block);
  for (const child of children) {
    const childType = getBlockTypeName(child);
    if (!isListType(childType)) continue;
    const nested = renderListItem(child, depth + 1);
    if (nested) lines.push(nested);
  }

  return lines.join('\n');
}

function codeLeafText(leaf: any): any {
  if (!leaf) return '';
  const raw = normalizeMarkdownText(leaf.textContent || '');
  return raw.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

function codeFenceDelimiter(content: any): any {
  const runs = String(content || '').match(/`+/g) || [];
  const longest = runs.reduce((max, s) => Math.max(max, s.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function normalizeCodeLanguage(raw: any): any {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  return value.replace(/[^a-z0-9_+.-]/g, '');
}

function detectCodeLanguage(block: any): any {
  if (!block || !block.querySelectorAll) return '';
  const attrs = [block.getAttribute('data-language'), block.getAttribute('data-code-language')];
  for (const a of attrs) {
    const language = normalizeCodeLanguage(a);
    if (language) return language;
  }

  const nodes = [block].concat(
    Array.from(block.querySelectorAll('[class],[data-language],[data-code-language]')).slice(0, 8),
  );
  for (const node of nodes) {
    if (!node || !node.getAttribute) continue;
    const dataLanguage = normalizeCodeLanguage(
      node.getAttribute('data-language') || node.getAttribute('data-code-language'),
    );
    if (dataLanguage) return dataLanguage;
    const className = String(node.getAttribute('class') || '');
    const m = className.match(/\blanguage-([a-z0-9_+.-]+)\b/i);
    if (m && m[1]) return normalizeCodeLanguage(m[1]);
  }
  return '';
}

function escapeMarkdownTableCell(value: any): any {
  const text = String(value || '')
    .replace(/\n+/g, ' ')
    .trim();
  // Escape pipes to avoid breaking table columns.
  return text.replace(/\|/g, '\\|');
}

function tableRowsFromHtmlTable(tableEl: any): any {
  const rows: any[] = Array.from(tableEl.querySelectorAll('tr')) as any[];
  return rows.map((tr: any) => Array.from(tr.querySelectorAll('th, td')));
}

function tableRowsFromRoleGrid(gridEl: any): any {
  const rows: any[] = Array.from(gridEl.querySelectorAll("[role='row']")) as any[];
  return rows.map((row: any) =>
    Array.from(row.querySelectorAll("[role='gridcell'],[role='cell'],[role='columnheader'],[role='rowheader']")),
  );
}

function cellToMarkdown(cellEl: any): any {
  if (!cellEl) return '';
  const leaf = cellEl.querySelector ? cellEl.querySelector("[data-content-editable-leaf='true']") : null;
  const md = leafToMarkdown(leaf);
  if (md) return md;
  const fallback = (cellEl as any).innerText || cellEl.textContent || '';
  return normalizeMarkdownText(fallback).trim();
}

function extractTableMarkdown(block: any): any {
  if (!block || !block.querySelector) return '';

  const table = block.querySelector('table');
  const grid = block.querySelector("[role='grid'],[role='table']");

  let rows = [];
  if (table) rows = tableRowsFromHtmlTable(table);
  else if (grid) rows = tableRowsFromRoleGrid(grid);

  function fallbackToTsv(): any {
    const raw = String((block as any).innerText || block.textContent || '');
    const lines = raw
      .split('\n')
      .map((l: any) => l.trim())
      .filter((l: any) => l.length);
    const hasTabs = lines.some((l) => l.includes('\t'));
    if (hasTabs) {
      const matrix = lines.map((l: any) => l.split('\t').map((c: any) => escapeMarkdownTableCell(c)));
      const cols = Math.max(0, ...matrix.map((r: any) => r.length));
      if (cols >= 2 && matrix.length >= 1) {
        const header = matrix[0].concat(Array(Math.max(0, cols - matrix[0].length)).fill(''));
        const sep = Array(cols).fill('---');
        const out = [];
        out.push(`| ${header.join(' | ')} |`);
        out.push(`| ${sep.join(' | ')} |`);
        for (const r of matrix.slice(1)) {
          const row = r.concat(Array(Math.max(0, cols - r.length)).fill(''));
          out.push(`| ${row.join(' | ')} |`);
        }
        return out.join('\n').trim();
      }
    }
    return '';
  }

  // Fallback: try to interpret `innerText` as TSV (Notion often uses tabs between cells).
  if (!rows.length) return fallbackToTsv();

  const matrix = rows.map((cells: any) => cells.map((cell: any) => escapeMarkdownTableCell(cellToMarkdown(cell))));
  const cols = Math.max(0, ...matrix.map((r: any) => r.length));
  if (cols < 2 || matrix.length < 1) return fallbackToTsv();

  const out = [];
  const headerRow = matrix[0].concat(Array(Math.max(0, cols - matrix[0].length)).fill(''));
  const sepRow = Array(cols).fill('---');
  out.push(`| ${headerRow.join(' | ')} |`);
  out.push(`| ${sepRow.join(' | ')} |`);
  for (const r of matrix.slice(1)) {
    const row = r.concat(Array(Math.max(0, cols - r.length)).fill(''));
    out.push(`| ${row.join(' | ')} |`);
  }
  return out.join('\n').trim();
}

function blockToMarkdown(block: any): any {
  const type = getBlockTypeName(block);

  const tableMd = extractTableMarkdown(block);
  if (tableMd) return tableMd;

  if (type === 'divider') return '---';

  if (type === 'equation') {
    const tex = texFromKatex(block);
    if (!tex) return '';
    return `$$\n${tex}\n$$`;
  }

  if (isListType(type)) return renderListItem(block, 0);

  if (type === 'code') {
    const leaf = blockLeaf(block);
    const code = codeLeafText(leaf);
    if (!code) return '';
    const fence = codeFenceDelimiter(code);
    const language = detectCodeLanguage(block);
    return `${fence}${language}\n${code}\n${fence}`;
  }

  const leaf = blockLeaf(block);
  const text = leafToMarkdown(leaf);
  if (!text) return '';

  if (type === 'header') return `# ${text}`;
  if (type === 'sub_header') return `## ${text}`;
  if (type === 'sub_sub_header') return `### ${text}`;

  if (type === 'quote') {
    const lines = text.split('\n').map((l: any) => `> ${l}`.trimEnd());
    return lines.join('\n');
  }

  if (type === 'callout') {
    const lines = text.split('\n').map((l: any) => `> ${l}`.trimEnd());
    return lines.join('\n');
  }

  return text;
}

function blockKind(block: any): any {
  const type = getBlockTypeName(block);
  if (type === 'bulleted_list' || type === 'numbered_list' || type === 'to_do_list') return 'list';
  if (type === 'quote' || type === 'callout') return 'quote';
  return 'para';
}

function extractUserMarkdown(wrapper: any): any {
  const leaf =
    wrapper.querySelector('div[style*="border-radius: 16px"] [data-content-editable-leaf="true"]') ||
    wrapper.querySelector("[data-content-editable-leaf='true']");
  const md = leafToMarkdown(leaf);
  return md || '';
}

function extractAssistantMarkdown(wrapper: any): any {
  const allBlocks: any[] = Array.from(wrapper.querySelectorAll('div[data-block-id]')) as any[];
  const blocks = allBlocks.filter((b: any) => isTopLevelBlock(b, wrapper));
  if (!blocks.length) return '';

  let out = '';
  let prevKind = '';
  for (const b of blocks) {
    const md = blockToMarkdown(b);
    if (!md) continue;
    const kind = blockKind(b);
    if (!out) {
      out = md;
    } else {
      const compact = (prevKind === 'list' && kind === 'list') || (prevKind === 'quote' && kind === 'quote');
      out += compact ? `\n${md}` : `\n\n${md}`;
    }
    prevKind = kind;
  }
  return out.trim();
}

const api = {
  extractUserMarkdown,
  extractAssistantMarkdown,
};

export default api;
