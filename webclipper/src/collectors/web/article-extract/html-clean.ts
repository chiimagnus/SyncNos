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

function isLikelyPlaceholderImageSrc(value: string) {
  const src = normalizeText(value).toLowerCase();
  if (!src) return true;
  if (src === 'about:blank') return true;
  if (src.startsWith('data:image/')) return true;
  return false;
}

function normalizeLazyLoadedImages(root: Element, baseHref: string) {
  const imgs = listElementsIncludingRoot(root, 'img');
  for (const node of imgs) {
    const el = node as HTMLImageElement;
    const src = normalizeText(el.getAttribute('src') || '');
    if (!isLikelyPlaceholderImageSrc(src)) continue;

    const candidateAttrs = ['data-src', 'data-original', 'data-url', 'data-lazy-src', 'data-actualsrc'];
    let picked = '';
    for (const attr of candidateAttrs) {
      const raw = normalizeText(el.getAttribute(attr) || '');
      if (!raw) continue;
      const sanitized = sanitizeUrl(raw, baseHref);
      if (!sanitized) continue;
      picked = sanitized;
      break;
    }

    if (picked) el.setAttribute('src', picked);
  }
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

function promoteTableCellAlignment(root: Element) {
  const cells = listElementsIncludingRoot(root, 'table th[style], table td[style]');
  for (const cell of cells) {
    const align = normalizeText(cell.getAttribute('align') || '').toLowerCase();
    if (align === 'left' || align === 'center' || align === 'right') continue;

    const style = String(cell.getAttribute('style') || '');
    const match = style.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right)\s*(?:;|$)/i);
    if (!match || !match[1]) continue;
    cell.setAttribute('align', String(match[1]).toLowerCase());
  }
}

export function cleanHtmlFragment(root: Element, baseHref: string) {
  listElementsIncludingRoot(root, 'script,style').forEach((node) => node.remove());
  promoteTableCellAlignment(root);
  listElementsIncludingRoot(root, '[style]').forEach((node) => node.removeAttribute('style'));
  normalizeLazyLoadedImages(root, baseHref);
  listElementsIncludingRoot(root, '[href]').forEach((node) => absolutizeAttr(node, 'href', baseHref));
  listElementsIncludingRoot(root, '[src]').forEach((node) => absolutizeAttr(node, 'src', baseHref));
  listElementsIncludingRoot(root, '[srcset]').forEach((node) => absolutizeSrcset(node, baseHref));
}
