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

function listElementsIncludingRoot(root: Element, selector: string) {
  const out = Array.from(root.querySelectorAll(selector)) as Element[];
  if (typeof root.matches === 'function' && root.matches(selector)) out.unshift(root);
  return out;
}

export function cleanHtmlFragment(root: Element, baseHref: string) {
  listElementsIncludingRoot(root, 'script,style').forEach((node) => node.remove());
  listElementsIncludingRoot(root, '[style]').forEach((node) => node.removeAttribute('style'));
  listElementsIncludingRoot(root, '[href]').forEach((node) => absolutizeAttr(node, 'href', baseHref));
  listElementsIncludingRoot(root, '[src]').forEach((node) => absolutizeAttr(node, 'src', baseHref));
  listElementsIncludingRoot(root, '[srcset]').forEach((node) => absolutizeSrcset(node, baseHref));
}
