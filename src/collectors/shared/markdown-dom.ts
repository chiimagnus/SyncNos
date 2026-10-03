export function normalizeMarkdown(markdown: unknown): string {
  const normalized = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  return normalized
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeInline(markdown: unknown): string {
  return normalizeMarkdown(markdown).replace(/\n+/g, ' ').trim();
}

function wrapInlineCode(text: unknown): string {
  const value = String(text || '');
  if (!value) return '``';
  const matches = value.match(/`+/g) || [];
  const maxTicks = matches.reduce((max, ticks) => Math.max(max, ticks.length), 0);
  const fence = '`'.repeat(Math.max(1, maxTicks + 1));
  return `${fence}${value}${fence}`;
}

function pickCodeLanguage(className: unknown): string {
  for (const part of String(className || '')
    .split(/\s+/)
    .filter(Boolean)) {
    const match = part.match(/^(?:language|lang)-([a-z0-9_#+.-]+)$/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return '';
}

function escapeTableCell(text: unknown): string {
  return String(text || '').replace(/\|/g, '\\|');
}

export function extractTextFromSanitizedClone(clone: Element | null): string {
  if (!clone) return '';
  const innerText = typeof (clone as HTMLElement).innerText === 'string' ? (clone as HTMLElement).innerText : '';
  if (innerText.trim()) return innerText;

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
  const parts: string[] = [];
  const textNode = typeof Node !== 'undefined' && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
  const elementNode = typeof Node !== 'undefined' && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

  function walk(node: Node): void {
    if (node.nodeType === textNode) {
      const value = node.nodeValue ? String(node.nodeValue) : '';
      if (value) parts.push(value);
      return;
    }
    if (node.nodeType !== elementNode) return;
    const element = node as Element;
    const tag = String(element.tagName || '').toUpperCase();
    if (tag === 'BR') {
      parts.push('\n');
      return;
    }
    for (const child of Array.from(element.childNodes)) walk(child);
    if (blockTags.has(tag)) parts.push('\n\n');
  }

  walk(clone);
  return parts.join('');
}

export function htmlToMarkdown(root: Element | null): string {
  if (!root) return '';
  const textNode = typeof Node !== 'undefined' && Node.TEXT_NODE ? Node.TEXT_NODE : 3;
  const elementNode = typeof Node !== 'undefined' && Node.ELEMENT_NODE ? Node.ELEMENT_NODE : 1;

  function renderChildren(element: Element, context: { listDepth: number }): string {
    return Array.from(element.childNodes)
      .map((child) => renderNode(child, context))
      .join('');
  }

  function listItemBodyClone(listItem: Element): Element {
    const clone = listItem.cloneNode(true) as Element;
    for (const nested of Array.from(clone.querySelectorAll('ul,ol'))) nested.remove();
    return clone;
  }

  function renderListItem(listItem: Element, marker: string, depth: number): string {
    const indent = '  '.repeat(Math.max(0, depth));
    const continuationIndent = `${indent}${' '.repeat(marker.length + 1)}`;
    const body = normalizeMarkdown(renderChildren(listItemBodyClone(listItem), { listDepth: depth })).replace(
      /\n{2,}/g,
      '\n',
    );
    const lines = body ? body.split('\n').filter(Boolean) : [];
    const output: string[] = [];
    if (lines.length) {
      output.push(`${indent}${marker} ${lines[0]}`);
      for (const line of lines.slice(1)) output.push(`${continuationIndent}${line}`);
    } else {
      output.push(`${indent}${marker}`);
    }

    const nestedLists = Array.from(listItem.querySelectorAll('ul,ol')).filter(
      (nested) => nested.closest('li') === listItem,
    );
    for (const nested of nestedLists) {
      const markdown = renderList(nested, nested.tagName.toLowerCase() === 'ol', depth + 1).trimEnd();
      if (markdown) output.push(markdown);
    }
    return output.join('\n');
  }

  function renderList(list: Element, ordered: boolean, depth: number): string {
    const start = Number.parseInt(String(list.getAttribute('start') || ''), 10);
    let index = Number.isFinite(start) ? start : 1;
    const items = Array.from(list.querySelectorAll('li')).filter((item) => item.closest('ul,ol') === list);
    const output: string[] = [];
    for (const item of items) {
      const marker = ordered ? `${index}.` : '-';
      output.push(renderListItem(item, marker, depth));
      if (ordered) index += 1;
    }
    return output.join('\n') + (output.length ? '\n\n' : '');
  }

  function renderTable(table: Element, context: { listDepth: number }): string {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';
    const matrix = rows.map((row) =>
      Array.from(row.children)
        .filter((cell) => ['th', 'td'].includes(cell.tagName.toLowerCase()))
        .map((cell) => escapeTableCell(normalizeInline(renderChildren(cell, context)))),
    );
    const columns = Math.max(0, ...matrix.map((row) => row.length));
    if (!columns) return '';
    const pad = (row: string[]) => row.concat(Array(Math.max(0, columns - row.length)).fill(''));
    const output = [`| ${pad(matrix[0]).join(' | ')} |`, `| ${Array(columns).fill('---').join(' | ')} |`];
    for (const row of matrix.slice(1)) output.push(`| ${pad(row).join(' | ')} |`);
    return `${output.join('\n')}\n\n`;
  }

  function renderNode(node: Node, context: { listDepth: number }): string {
    if (node.nodeType === textNode) {
      const raw = node.nodeValue ? String(node.nodeValue) : '';
      if (!raw) return '';
      if (raw.includes('\n') || raw.includes('\r')) return raw.replace(/\s+/g, ' ');
      return /^\s+$/.test(raw) ? ' ' : raw;
    }
    if (node.nodeType !== elementNode) return '';

    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (['script', 'style', 'svg', 'path', 'button'].includes(tag)) return '';

    if (tag === 'pre') {
      const code = element.querySelector('code');
      const language = pickCodeLanguage(code?.getAttribute('class'));
      const text = String((code ? code.textContent : element.textContent) || '').replace(/\n+$/g, '');
      return text.trim() ? `\n\n\`\`\`${language}\n${text}\n\`\`\`\n\n` : '';
    }
    if (tag === 'code') return wrapInlineCode(element.textContent || '');
    if (tag === 'strong' || tag === 'b') return `**${normalizeInline(renderChildren(element, context))}**`;
    if (tag === 'em' || tag === 'i') return `*${normalizeInline(renderChildren(element, context))}*`;
    if (tag === 'del' || tag === 's') return `~~${normalizeInline(renderChildren(element, context))}~~`;

    if (tag === 'a') {
      const href = String(element.getAttribute('href') || '').trim();
      const text = normalizeInline(renderChildren(element, context));
      return /^https?:\/\//i.test(href) ? `[${text || href}](${href})` : text;
    }
    if (tag === 'img') {
      const src = String(element.getAttribute('src') || '').trim();
      return /^https?:\/\//i.test(src) ? `![](${src})` : '';
    }
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      const text = normalizeMarkdown(renderChildren(element, context));
      return text ? `${'#'.repeat(level)} ${text}\n\n` : '';
    }
    if (tag === 'table') return renderTable(element, context);
    if (tag === 'ul') return renderList(element, false, context.listDepth);
    if (tag === 'ol') return renderList(element, true, context.listDepth);
    if (tag === 'blockquote') {
      const body = normalizeMarkdown(renderChildren(element, context));
      return body
        ? `${body
            .split('\n')
            .map((line) => (line ? `> ${line}` : '>'))
            .join('\n')}\n\n`
        : '';
    }
    if (tag === 'p') {
      const text = normalizeMarkdown(renderChildren(element, context));
      return text ? `${text}\n\n` : '';
    }
    if (tag === 'li') {
      const text = normalizeMarkdown(renderChildren(element, context));
      return text ? `${text}\n` : '';
    }
    return renderChildren(element, context);
  }

  return normalizeMarkdown(renderNode(root, { listDepth: 0 }));
}
