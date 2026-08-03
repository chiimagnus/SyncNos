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

function isDiscourseOriginalImageLink(src: string, href: string) {
  try {
    const thumbnail = new URL(src);
    const original = new URL(href);
    if (thumbnail.origin !== original.origin) return false;

    const thumbnailParts = thumbnail.pathname.split('/').filter(Boolean);
    const originalParts = original.pathname.split('/').filter(Boolean);
    if (thumbnailParts[0] !== 'optimized' || originalParts[0] !== 'original') return false;
    if (thumbnailParts.slice(1, -1).join('/') !== originalParts.slice(1, -1).join('/')) return false;

    const thumbnailName = thumbnailParts.at(-1) || '';
    const originalName = originalParts.at(-1) || '';
    return thumbnailName.replace(/_\d+_\d+x\d+(?=\.[^.]+$)/i, '') === originalName;
  } catch (_e) {
    return false;
  }
}

function promoteDiscourseOriginalImages(root: Element) {
  for (const node of listElementsIncludingRoot(root, 'a[href] > img[src]')) {
    const image = node as HTMLImageElement;
    const link = image.parentElement as HTMLAnchorElement | null;
    const src = normalizeText(image.getAttribute('src') || '');
    const href = normalizeText(link?.getAttribute('href') || '');
    if (!link || !isDiscourseOriginalImageLink(src, href)) continue;
    image.setAttribute('src', href);
    link.replaceWith(image);
  }
}

function isEmojiImage(image: HTMLImageElement) {
  if (image.classList.contains('emoji')) return true;
  try {
    return /(?:^|\/)images\/emoji(?:\/|$)/i.test(new URL(image.src).pathname);
  } catch (_e) {
    return false;
  }
}

function removeEmojiImages(root: Element) {
  for (const node of listElementsIncludingRoot(root, 'img')) {
    const image = node as HTMLImageElement;
    if (!isEmojiImage(image)) continue;

    const link = image.closest('a[href]') as HTMLAnchorElement | null;
    image.remove();
    if (link && !normalizeText(link.textContent || '')) link.remove();
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

type TableAlign = 'left' | 'center' | 'right';

function normalizeTableAlign(value: unknown): TableAlign | '' {
  const align = normalizeText(value).toLowerCase();
  if (!align) return '';
  if (align === 'left' || align === 'start' || align === 'justify') return 'left';
  if (align === 'center' || align === 'middle') return 'center';
  if (align === 'right' || align === 'end') return 'right';
  return '';
}

function copyAttributes(from: Element, to: Element) {
  const attrs = Array.from(from.attributes || []);
  for (const attr of attrs) to.setAttribute(attr.name, attr.value);
}

function promoteFirstTableRowToHeader(root: Element) {
  const tables = listElementsIncludingRoot(root, 'table');
  for (const table of tables) {
    const firstRow = table.querySelector('tr') as HTMLTableRowElement | null;
    if (!firstRow) continue;

    const cells = Array.from(firstRow.children || []).filter((node) => {
      const name = String((node as Element).tagName || '').toLowerCase();
      return name === 'th' || name === 'td';
    }) as Element[];
    if (!cells.length) continue;

    const headingRow = cells.every((cell) => String(cell.tagName || '').toLowerCase() === 'th');
    if (headingRow) continue;

    for (const cell of cells) {
      if (String(cell.tagName || '').toLowerCase() !== 'td') continue;
      const th = (cell.ownerDocument || document).createElement('th');
      copyAttributes(cell, th);
      th.innerHTML = cell.innerHTML;
      cell.replaceWith(th);
    }
  }
}

function promoteTableCellAlignment(root: Element) {
  const cells = listElementsIncludingRoot(root, 'table th, table td');
  for (const cell of cells) {
    const alignFromAttr = normalizeTableAlign(cell.getAttribute('align') || '');
    if (alignFromAttr) {
      cell.setAttribute('align', alignFromAttr);
      continue;
    }

    const style = String(cell.getAttribute('style') || '');
    const match = style.match(/(?:^|;)\s*text-align\s*:\s*([a-z-]+)\b[^;]*(?:;|$)/i);
    if (!match || !match[1]) continue;
    const alignFromStyle = normalizeTableAlign(match[1]);
    if (!alignFromStyle) continue;
    cell.setAttribute('align', alignFromStyle);
  }
}

export function cleanHtmlFragment(root: Element, baseHref: string) {
  listElementsIncludingRoot(root, 'script,style').forEach((node) => node.remove());
  promoteFirstTableRowToHeader(root);
  promoteTableCellAlignment(root);
  listElementsIncludingRoot(root, '[style]').forEach((node) => node.removeAttribute('style'));
  normalizeLazyLoadedImages(root, baseHref);
  listElementsIncludingRoot(root, '[href]').forEach((node) => absolutizeAttr(node, 'href', baseHref));
  listElementsIncludingRoot(root, '[src]').forEach((node) => absolutizeAttr(node, 'src', baseHref));
  promoteDiscourseOriginalImages(root);
  removeEmojiImages(root);
  listElementsIncludingRoot(root, '[srcset]').forEach((node) => absolutizeSrcset(node, baseHref));
}
