import TurndownService from 'turndown';
import { normalizeText, sanitizeUrl } from '@collectors/web/article-extract/url';

function absolutizeAttr(node: Element, attr: string, baseHref: string) {
  const value = normalizeText(node.getAttribute(attr) || '');
  if (!value) return;
  const sanitized = sanitizeUrl(value, baseHref);
  if (!sanitized) {
    node.removeAttribute(attr);
    return;
  }
  node.setAttribute(attr, sanitized);
}

function absolutizeSrcset(node: Element, baseHref: string) {
  const value = normalizeText(node.getAttribute('srcset') || '');
  if (!value) return;
  const normalized = value
    .split(',')
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .map((entry) => {
      const [candidate, ...rest] = entry.split(/\s+/);
      const sanitized = sanitizeUrl(candidate, baseHref);
      if (!sanitized) return '';
      return rest.length ? `${sanitized} ${rest.join(' ')}` : sanitized;
    })
    .filter(Boolean)
    .join(', ');
  if (!normalized) {
    node.removeAttribute('srcset');
    return;
  }
  node.setAttribute('srcset', normalized);
}

function normalizeHtmlForTurndown(root: Element, baseHref: string) {
  root.querySelectorAll('script,style').forEach((node) => node.remove());
  root.querySelectorAll('[style]').forEach((node) => (node as Element).removeAttribute('style'));
  root.querySelectorAll('[href]').forEach((node) => absolutizeAttr(node as Element, 'href', baseHref));
  root.querySelectorAll('[src]').forEach((node) => absolutizeAttr(node as Element, 'src', baseHref));
  root.querySelectorAll('[srcset]').forEach((node) => absolutizeSrcset(node as Element, baseHref));
}

function pickTurndownRoot(wrapper: HTMLDivElement) {
  const directChildren = Array.from(wrapper.children || []);
  if (directChildren.length !== 1) return wrapper;
  return String(directChildren[0]?.tagName || '').toLowerCase() === 'article' ? directChildren[0] : wrapper;
}

function createTurndownService() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  turndown.addRule('syncnos-summary', {
    filter: 'summary',
    replacement(content) {
      const text = normalizeText(content);
      return text ? `\n**${text}**\n\n` : '\n';
    },
  });

  turndown.addRule('syncnos-details', {
    filter: 'details',
    replacement(content) {
      const text = normalizeText(content);
      return text ? `\n${text}\n\n` : '\n';
    },
  });

  return turndown;
}

export function htmlToMarkdownTurndown(html: unknown, baseHref: string) {
  const normalizedHtml = normalizeText(html);
  if (!normalizedHtml) return '';

  try {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = normalizedHtml;
    const root = pickTurndownRoot(wrapper);
    normalizeHtmlForTurndown(root, baseHref);
    const markdown = createTurndownService().turndown(root as any);
    return normalizeText(markdown);
  } catch (_e) {
    return '';
  }
}
