import { normalizeText, sanitizeUrl } from '@collectors/web/article-extract/url';

function normalizeInlineText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ');
}

function normalizeDetailsElementsForMarkdown(root: Element) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  const detailsNodes = Array.from(root.querySelectorAll('details') as any) as any[];
  if (!detailsNodes.length) return;

  const doc = root.ownerDocument || document;
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

function escapeMarkdownLabel(value: unknown) {
  return String(value || '').replace(/\]/g, '\\]');
}

function isBlockTag(tag: unknown) {
  return [
    'p',
    'div',
    'section',
    'article',
    'main',
    'header',
    'footer',
    'aside',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'table',
    'figure',
    'hr',
  ].includes(String(tag || '').toLowerCase());
}

export function htmlToMarkdown(html: unknown, text: unknown, baseHref: string) {
  const normalizedHtml = normalizeText(html);
  if (!normalizedHtml) return normalizeText(text);

  try {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = normalizedHtml;
    const root = wrapper.querySelector('article') || wrapper;
    normalizeDetailsElementsForMarkdown(root);
    const md = renderBlock(root, baseHref);
    return normalizeText(md);
  } catch (_e) {
    return normalizeText(text);
  }
}

function renderInlineNode(node: any, baseHref: string): string {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) return normalizeInlineText(node.nodeValue || '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = String(node.tagName || '').toLowerCase();
  if (!tag) return '';

  if (tag === 'br') return '\n';
  if (tag === 'img') {
    const src = sanitizeUrl(node.getAttribute('src') || node.getAttribute('data-src') || '', baseHref);
    if (!src) return '';
    const alt = escapeMarkdownLabel(normalizeText(node.getAttribute('alt') || ''));
    return `![${alt}](${src})`;
  }
  if (tag === 'a') {
    const href = sanitizeUrl(node.getAttribute('href') || '', baseHref);
    const linkedImg = node.querySelector ? node.querySelector('img') : null;
    if (linkedImg) {
      const src = sanitizeUrl(linkedImg.getAttribute('src') || linkedImg.getAttribute('data-src') || '', baseHref);
      if (src) {
        const alt = escapeMarkdownLabel(
          normalizeText(linkedImg.getAttribute('alt') || node.getAttribute('title') || ''),
        );
        const image = `![${alt}](${src})`;
        return href ? `[${image}](${href})` : image;
      }
    }

    const label = escapeMarkdownLabel(normalizeText(node.textContent || ''));
    if (!label) return '';
    if (!href) return label;
    return `[${label}](${href})`;
  }
  if (tag === 'code') {
    const value = normalizeText(node.textContent || '');
    return value ? `\`${value}\`` : '';
  }
  if (tag === 'strong' || tag === 'b') {
    const inner = renderInlineChildren(node, baseHref);
    return inner ? `**${inner}**` : '';
  }
  if (tag === 'em' || tag === 'i') {
    const inner = renderInlineChildren(node, baseHref);
    return inner ? `*${inner}*` : '';
  }
  return renderInlineChildren(node, baseHref);
}

function renderInlineChildren(node: any, baseHref: string): string {
  if (!node) return '';
  const parts: string[] = [];
  for (const child of Array.from(node.childNodes || [])) parts.push(renderInlineNode(child, baseHref));
  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ');
}

function renderBlock(node: any, baseHref: string, depth = 0): string {
  if (!node || depth > 50) return '';
  if (node.nodeType === Node.TEXT_NODE) return normalizeInlineText(node.nodeValue || '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = String(node.tagName || '').toLowerCase();
  if (!tag) return '';

  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
    const level = Number(tag.slice(1));
    const value = normalizeText(node.textContent || '');
    if (!value) return '';
    return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${value}\n\n`;
  }

  if (tag === 'p') {
    const value = renderInlineChildren(node, baseHref).trim();
    return value ? `${value}\n\n` : '';
  }

  if (tag === 'pre') {
    const codeNode = node.querySelector ? node.querySelector(':scope > code') || node.querySelector('code') : null;
    const value = normalizeText(codeNode?.textContent || node.textContent || '');
    return value ? `\n\`\`\`\n${value}\n\`\`\`\n\n` : '';
  }

  if (tag === 'blockquote') {
    const value = normalizeText(node.textContent || '');
    if (!value) return '';
    const lines = value.split('\n').map((l) => `> ${l}`);
    return `${lines.join('\n')}\n\n`;
  }

  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(node.querySelectorAll(':scope > li'));
    const out: string[] = [];
    for (const li of items) {
      const value = renderInlineChildren(li, baseHref).trim();
      if (!value) continue;
      out.push(tag === 'ol' ? `1. ${value}` : `- ${value}`);
    }
    return out.length ? `${out.join('\n')}\n\n` : '';
  }

  if (tag === 'img') {
    const src = sanitizeUrl(node.getAttribute('src') || node.getAttribute('data-src') || '', baseHref);
    if (!src) return '';
    const alt = escapeMarkdownLabel(normalizeText(node.getAttribute('alt') || ''));
    return `![${alt}](${src})\n\n`;
  }

  if (isBlockTag(tag)) {
    const parts: string[] = [];
    for (const child of Array.from(node.childNodes || [])) parts.push(renderBlock(child, baseHref, depth + 1));
    return parts.join('');
  }

  const inline = renderInlineChildren(node, baseHref).trim();
  return inline ? `${inline}\n\n` : '';
}
