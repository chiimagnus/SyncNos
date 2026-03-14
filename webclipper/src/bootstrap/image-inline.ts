const INLINE_HTTP_IMAGES_MAX_COUNT = 12;
const INLINE_HTTP_IMAGE_MAX_BYTES = 2_000_000;
const INLINE_HTTP_IMAGES_MAX_TOTAL_BYTES = 8_000_000;

function isHttpUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  return /^https?:\/\//i.test(text);
}

function isDataImageUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  if (!text) return false;
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?(?:;base64)?,/i.test(text);
}

function stripAngleBrackets(url: string): string {
  const text = String(url || '').trim();
  if (text.startsWith('<') && text.endsWith('>')) return text.slice(1, -1).trim();
  return text;
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;

function detectImageContentType(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 8) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return 'image/png';
    }
  }
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  }
  if (bytes.length >= 6) {
    const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  }
  return null;
}

function parseContentType(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.split(';')[0]!.trim().toLowerCase();
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function replaceMarkdownImageUrls(markdown: string, replacements: Map<string, string>): string {
  if (!replacements.size) return markdown;
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  return String(markdown || '').replace(MARKDOWN_IMAGE_RE, (full, altRaw, urlPartRaw, titleRaw) => {
    const alt = altRaw ? String(altRaw) : '';
    const urlPart = urlPartRaw ? String(urlPartRaw) : '';
    const title = titleRaw ? String(titleRaw) : '';
    const url = stripAngleBrackets(urlPart);
    const next = replacements.get(url);
    if (!next) return full;
    const nextPart = urlPart.trim().startsWith('<') && !isDataImageUrl(next) ? `<${next}>` : next;
    return `![${alt}](${nextPart}${title})`;
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, reason: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer: any = null;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(reason)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

async function canvasToPngBlob(canvas: any): Promise<Blob | null> {
  try {
    if (!canvas || typeof canvas.toBlob !== 'function') return null;
    return await new Promise((resolve) => {
      try {
        canvas.toBlob((blob: Blob | null) => resolve(blob), 'image/png');
      } catch (_e) {
        resolve(null);
      }
    });
  } catch (_e) {
    return null;
  }
}

function byteSizeFromDataUrl(dataUrl: string): number {
  const text = String(dataUrl || '');
  const comma = text.indexOf(',');
  if (comma < 0) return 0;
  const base64 = text.slice(comma + 1);
  const len = base64.length;
  if (!len) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

function shouldPreferImageElement(url: URL): boolean {
  // Some endpoints (e.g. ChatGPT estuary) are frequently blocked for fetch() from extension contexts,
  // but load fine as <img> subresource requests.
  const pathname = String(url.pathname || '');
  return /\/backend-api\/estuary\//i.test(pathname);
}

async function downloadAsDataUrlSameOriginViaImageElement(input: {
  url: string;
  origin: string;
  maxBytes: number;
  timeoutMs?: number;
}): Promise<{ ok: true; dataUrl: string; byteSize: number } | { ok: false; reason: string }> {
  const safeUrl = String(input.url || '').trim();
  if (!isHttpUrl(safeUrl)) return { ok: false, reason: 'invalid_url' };
  let parsed: URL | null = null;
  try {
    parsed = new URL(safeUrl);
  } catch (_e) {
    parsed = null;
  }
  if (!parsed || parsed.origin !== input.origin) return { ok: false, reason: 'cross_origin' };

  const ImageCtor = (globalThis as any).Image;
  const doc = (globalThis as any).document;
  if (typeof ImageCtor !== 'function' || !doc || typeof doc.createElement !== 'function') {
    return { ok: false, reason: 'no_dom' };
  }

  const loadPromise = new Promise<any>((resolve, reject) => {
    try {
      const img = new ImageCtor();
      try {
        img.decoding = 'async';
      } catch (_e) {
        // ignore
      }
      try {
        // Reduce referrer-related auth issues; cookies still apply for same-origin.
        img.referrerPolicy = 'no-referrer';
      } catch (_e) {
        // ignore
      }
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image_load_failed'));
      img.src = safeUrl;
    } catch (_e) {
      reject(new Error('image_ctor_failed'));
    }
  });

  let img: any = null;
  try {
    img = await withTimeout(loadPromise, input.timeoutMs || 10_000, 'image_timeout');
  } catch (e: any) {
    const msg = String(e?.message || '');
    return { ok: false, reason: msg === 'image_load_failed' ? 'image_load_failed' : msg === 'image_timeout' ? 'timeout' : 'image_failed' };
  }

  const width = Number(img?.naturalWidth || img?.width || 0);
  const height = Number(img?.naturalHeight || img?.height || 0);
  if (!width || !height) return { ok: false, reason: 'empty' };

  try {
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx || typeof ctx.drawImage !== 'function') return { ok: false, reason: 'canvas_failed' };
    ctx.drawImage(img, 0, 0);

    const blob = await canvasToPngBlob(canvas);
    if (!blob) return { ok: false, reason: 'to_blob_failed' };
    if ((blob.size || 0) > input.maxBytes) return { ok: false, reason: 'too_large' };

    const buffer = await blob.arrayBuffer();
    const byteSize = buffer.byteLength || 0;
    if (!byteSize) return { ok: false, reason: 'empty' };
    if (byteSize > input.maxBytes) return { ok: false, reason: 'too_large' };

    const base64 = arrayBufferToBase64(buffer);
    const dataUrl = `data:image/png;base64,${base64}`;
    const computedSize = byteSizeFromDataUrl(dataUrl) || byteSize;
    if (computedSize > input.maxBytes) return { ok: false, reason: 'too_large' };
    return { ok: true, dataUrl, byteSize: computedSize };
  } catch (_e) {
    return { ok: false, reason: 'canvas_tainted' };
  }
}

async function downloadAsDataUrlSameOriginViaFetch(input: {
  url: string;
  origin: string;
  referrer?: string;
  maxBytes: number;
}): Promise<{ ok: true; dataUrl: string; byteSize: number } | { ok: false; reason: string }> {
  const safeUrl = String(input.url || '').trim();
  if (!isHttpUrl(safeUrl)) return { ok: false, reason: 'invalid_url' };
  let parsed: URL | null = null;
  try {
    parsed = new URL(safeUrl);
  } catch (_e) {
    parsed = null;
  }
  if (!parsed || parsed.origin !== input.origin) return { ok: false, reason: 'cross_origin' };

  try {
    const res = await fetch(safeUrl, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      headers: { Accept: 'image/*,*/*;q=0.8' },
      ...(isHttpUrl(input.referrer) ? { referrer: String(input.referrer) } : {}),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };

    const headerType = parseContentType(res.headers.get('content-type'));
    const buffer = await res.arrayBuffer();
    const byteSize = buffer.byteLength || 0;
    if (!byteSize) return { ok: false, reason: 'empty' };
    if (byteSize > input.maxBytes) return { ok: false, reason: 'too_large' };

    const contentType = headerType.startsWith('image/')
      ? headerType
      : (headerType === 'application/octet-stream' || !headerType)
        ? (detectImageContentType(buffer) || '')
        : '';
    if (!contentType || !contentType.startsWith('image/')) return { ok: false, reason: 'non_image' };

    const base64 = arrayBufferToBase64(buffer);
    return { ok: true, dataUrl: `data:${contentType};base64,${base64}`, byteSize };
  } catch (_e) {
    return { ok: false, reason: 'fetch_failed' };
  }
}

async function downloadAsDataUrlSameOrigin(input: {
  url: string;
  origin: string;
  referrer?: string;
  maxBytes: number;
}): Promise<{ ok: true; dataUrl: string; byteSize: number } | { ok: false; reason: string }> {
  const safeUrl = String(input.url || '').trim();
  if (!isHttpUrl(safeUrl)) return { ok: false, reason: 'invalid_url' };
  let parsed: URL | null = null;
  try {
    parsed = new URL(safeUrl);
  } catch (_e) {
    parsed = null;
  }
  if (!parsed || parsed.origin !== input.origin) return { ok: false, reason: 'cross_origin' };

  const preferImage = shouldPreferImageElement(parsed);
  const ordered = preferImage ? (['image', 'fetch'] as const) : (['fetch', 'image'] as const);
  let last: { ok: false; reason: string } | null = null;

  for (const mode of ordered) {
    // eslint-disable-next-line no-await-in-loop
    const res =
      mode === 'image'
        ? await downloadAsDataUrlSameOriginViaImageElement({ url: safeUrl, origin: input.origin, maxBytes: input.maxBytes })
        : await downloadAsDataUrlSameOriginViaFetch(input);
    if (res.ok) return res;
    last = res;

    // If the environment has no DOM, skip the image-element attempt quickly.
    if (mode === 'image' && res.reason === 'no_dom') continue;
  }

  return last || { ok: false, reason: 'fetch_failed' };
}

export async function inlineSameOriginImagesInSnapshot(input: {
  snapshot: any;
  onlyMessageKeys?: Set<string> | null;
  urlCache?: Map<string, string>;
}): Promise<{ snapshot: any; inlinedCount: number; inlinedBytes: number; warningFlags: string[] }> {
  const snapshot = input.snapshot;
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const onlyKeys = input.onlyMessageKeys || null;
  const urlCache = input.urlCache || new Map<string, string>();

  const origin = String(globalThis.location?.origin || '').trim();
  const referrer = String(snapshot?.conversation?.url || globalThis.location?.href || '');
  const warningFlags = new Set<string>();

  let inlinedCount = 0;
  let inlinedBytes = 0;

  for (const msg of messages) {
    if (!msg || !msg.messageKey) continue;
    if (onlyKeys && !onlyKeys.has(String(msg.messageKey))) continue;

    const markdown = msg.contentMarkdown && String(msg.contentMarkdown).trim() ? String(msg.contentMarkdown) : '';
    if (!markdown) continue;

    MARKDOWN_IMAGE_RE.lastIndex = 0;
    const urls: string[] = [];
    let m: RegExpExecArray | null = null;
    while ((m = MARKDOWN_IMAGE_RE.exec(markdown)) != null) {
      const urlPart = m[2] ? String(m[2]) : '';
      const url = stripAngleBrackets(urlPart);
      if (!isHttpUrl(url) || isDataImageUrl(url)) continue;
      urls.push(url);
    }
    if (!urls.length) continue;

    const replacements = new Map<string, string>();
    for (const url of urls) {
      if (replacements.has(url)) continue;

      if (inlinedCount >= INLINE_HTTP_IMAGES_MAX_COUNT) {
        warningFlags.add('inline_images_count_limit_reached');
        continue;
      }
      if (inlinedBytes >= INLINE_HTTP_IMAGES_MAX_TOTAL_BYTES) {
        warningFlags.add('inline_images_total_bytes_limit_reached');
        continue;
      }

      const cached = urlCache.get(url);
      if (cached && isDataImageUrl(cached)) {
        replacements.set(url, cached);
        inlinedCount += 1;
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const downloaded = await downloadAsDataUrlSameOrigin({
        url,
        origin,
        referrer,
        maxBytes: INLINE_HTTP_IMAGE_MAX_BYTES,
      });
      if (!downloaded.ok) {
        if (downloaded.reason === 'too_large') warningFlags.add('inline_images_single_bytes_limit_reached');
        else if (downloaded.reason !== 'cross_origin') warningFlags.add('inline_images_download_failed');
        continue;
      }
      if ((inlinedBytes + downloaded.byteSize) > INLINE_HTTP_IMAGES_MAX_TOTAL_BYTES) {
        warningFlags.add('inline_images_total_bytes_limit_reached');
        continue;
      }

      urlCache.set(url, downloaded.dataUrl);
      replacements.set(url, downloaded.dataUrl);
      inlinedCount += 1;
      inlinedBytes += downloaded.byteSize;
    }

    if (replacements.size) {
      const nextMarkdown = replaceMarkdownImageUrls(markdown, replacements);
      if (nextMarkdown !== markdown) msg.contentMarkdown = nextMarkdown;
    }
  }

  return { snapshot, inlinedCount, inlinedBytes, warningFlags: Array.from(warningFlags) };
}
