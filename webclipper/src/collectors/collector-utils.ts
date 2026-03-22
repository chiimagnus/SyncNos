export function conversationKeyFromLocation(locationArg: { pathname?: string; href?: string } | null): string {
  try {
    const pathname = locationArg && typeof locationArg.pathname === 'string' ? locationArg.pathname : '';
    const href = locationArg && typeof locationArg.href === 'string' ? locationArg.href : '';
    return (pathname || '/').replace(/\//g, '_').replace(/^_+/, '') || href.split('?')[0];
  } catch (_e) {
    return '';
  }
}

export function inEditMode(root: ParentNode | null): boolean {
  if (!root || typeof (root as any).querySelector !== 'function') return false;
  const textarea = (root as any).querySelector('textarea');
  if (!textarea) return false;
  return document.activeElement === textarea || textarea.contains(document.activeElement);
}

function isHttpUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  return /^https?:\/\//i.test(text);
}

function isDataImageUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  if (!text) return false;
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?(?:;base64)?,/i.test(text);
}

function parseSrcset(srcset: unknown): Array<{ url: string; score: number }> {
  const raw = String(srcset || '').trim();
  if (!raw) return [];
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const output: Array<{ url: string; score: number }> = [];
  for (const item of items) {
    const parts = item.split(/\s+/).filter(Boolean);
    const url = parts[0] ? String(parts[0]).trim() : '';
    if (!isHttpUrl(url)) continue;

    const descriptor = parts[1] ? String(parts[1]).trim() : '';
    let score = 0;
    const descriptorMatch = descriptor.match(/^(\d+(?:\.\d+)?)(w|x)$/i);
    if (descriptorMatch) {
      score = Number(descriptorMatch[1]) || 0;
      if (String(descriptorMatch[2]).toLowerCase() === 'x') score *= 10_000;
    }
    output.push({ url, score });
  }
  output.sort((left, right) => (right.score || 0) - (left.score || 0));
  return output;
}

function bestImageUrl(image: any): string {
  if (!image) return '';
  const current = image.currentSrc ? String(image.currentSrc).trim() : '';
  if (isHttpUrl(current)) return current;

  const srcset = image.getAttribute ? image.getAttribute('srcset') : '';
  const fromSrcset = parseSrcset(srcset);
  if (fromSrcset.length) return fromSrcset[0].url;

  const src = image.src
    ? String(image.src).trim()
    : image.getAttribute
      ? String(image.getAttribute('src') || '').trim()
      : '';
  if (isHttpUrl(src)) return src;
  return '';
}

export function extractImageUrlsFromElement(element: ParentNode | null): string[] {
  if (!element || typeof (element as any).querySelectorAll !== 'function') return [];
  const images = Array.from((element as any).querySelectorAll('img'));
  const seen = new Set<string>();
  const output: string[] = [];
  for (const image of images) {
    const url = bestImageUrl(image);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push(url);
  }
  return output;
}

export function appendImageMarkdown(
  markdown: unknown,
  imageUrls: unknown[],
  options?: { allowDataImageUrls?: boolean },
): string {
  const base = String(markdown || '').trimEnd();
  const urls = Array.isArray(imageUrls) ? imageUrls.map((url) => String(url || '').trim()).filter(Boolean) : [];
  const normalized = urls.filter(
    (url) => isHttpUrl(url) || (options?.allowDataImageUrls ? isDataImageUrl(url) : false),
  );
  if (!normalized.length) return base;

  const lines: string[] = [];
  for (const url of normalized) {
    if (base && base.includes(url)) continue;
    lines.push(`![](${url})`);
  }
  if (!lines.length) return base;
  if (!base) return lines.join('\n');

  const parts = base.split('\n');
  let lastNonEmpty = '';
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const line = String(parts[index] || '').trim();
    if (!line) continue;
    lastNonEmpty = line;
    break;
  }
  const endsWithImageLine = /^!\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)\s*$/.test(lastNonEmpty);
  const separator = endsWithImageLine ? '\n' : '\n\n';
  return `${base}${separator}${lines.join('\n')}`;
}
