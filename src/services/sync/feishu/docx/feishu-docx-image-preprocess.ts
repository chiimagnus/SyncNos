import { sha256Hex } from '@services/sync/shared/content-hash';
import type { ImageAsset } from '@services/conversations/data/image-storage';

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function stripAngleBrackets(urlPart: string): string {
  const t = safeString(urlPart);
  if (t.startsWith('<') && t.endsWith('>')) return t.slice(1, -1).trim();
  return t;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(safeString(url));
}

function isDataImageUrl(url: string): boolean {
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?;base64,/i.test(safeString(url));
}

function parseSyncnosAssetId(url: string): number {
  const m = /^syncnos-asset:\/\/(\d+)$/i.exec(safeString(url));
  if (!m) return 0;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function normalizeImageExt(ext: string): string {
  const e = safeString(ext).toLowerCase();
  if (e === 'jpeg') return 'jpg';
  if (e === 'svg+xml') return 'svg';
  if (e === 'x-icon') return 'ico';
  if (!e) return 'png';
  if (!/^[a-z0-9]+$/i.test(e)) return 'png';
  return e;
}

function extFromContentType(contentType: string): string {
  const ct = safeString(contentType).toLowerCase().split(';')[0] || '';
  if (ct === 'image/png') return 'png';
  if (ct === 'image/jpeg') return 'jpg';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/gif') return 'gif';
  if (ct === 'image/svg+xml') return 'svg';
  if (ct.startsWith('image/')) return normalizeImageExt(ct.slice('image/'.length));
  return 'png';
}

function decodeDataUrlToBlob(dataUrl: string): { blob: Blob; contentType: string } | null {
  const src = safeString(dataUrl);
  const m = src.match(/^data:(image\/[a-z0-9.+-]+)(?:;charset=[a-z0-9._-]+)?;base64,(.*)$/i);
  if (!m) return null;
  const contentType = safeString(m[1]).toLowerCase();
  const payload = safeString(m[2]);
  if (!payload) return null;

  let bytes: Uint8Array | null = null;
  try {
    if (typeof atob === 'function') {
      const bin = atob(payload);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      bytes = out;
    } else if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(payload, 'base64');
      bytes = new Uint8Array(buf);
    }
  } catch (_e) {
    bytes = null;
  }
  if (!bytes || !bytes.byteLength) return null;
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return { blob: new Blob([copy], { type: contentType }), contentType };
}

export type FeishuMarkdownImageSource = {
  sourceUrl: string;
  urlForConvert: string;
  blob?: Blob;
  contentType?: string;
  // For diagnostics only; never use for matching.
  kind: 'http' | 'data' | 'syncnos_asset';
};

export type FeishuMarkdownPreprocessResult = {
  markdownForConvert: string;
  imageSourcesInOrder: FeishuMarkdownImageSource[];
};

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+\"[^\"]*\")?\s*\)/g;

async function toPlaceholderUrl(prefix: string, stableKey: string, ext: string): Promise<string> {
  const hash = await sha256Hex(stableKey).catch(() => '');
  const id = hash ? hash.slice(0, 16) : String(Math.random()).slice(2);
  return `https://syncnos.invalid/${prefix}/${id}.${normalizeImageExt(ext)}`;
}

export async function preprocessFeishuDocxMarkdownImages(
  markdown: string,
  resolveImageAsset: (assetId: number) => Promise<ImageAsset | null>,
): Promise<FeishuMarkdownPreprocessResult> {
  const src = String(markdown || '');
  if (!src) return { markdownForConvert: '', imageSourcesInOrder: [] };

  const cache = new Map<string, Promise<FeishuMarkdownImageSource>>();
  const imageSourcesInOrder: FeishuMarkdownImageSource[] = [];

  const markdownForConvert = await (async () => {
    MARKDOWN_IMAGE_RE.lastIndex = 0;
    const parts: string[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null = null;

    while ((match = MARKDOWN_IMAGE_RE.exec(src)) != null) {
      const start = Number(match.index) || 0;
      const full = match[0] || '';
      const urlRaw = stripAngleBrackets(match[2] || '');

      parts.push(src.slice(cursor, start));

      const computed =
        cache.get(urlRaw) ||
        (async () => {
          const sourceUrl = safeString(urlRaw);
          if (isHttpUrl(sourceUrl)) {
            return { kind: 'http' as const, sourceUrl, urlForConvert: sourceUrl };
          }

          const assetId = parseSyncnosAssetId(sourceUrl);
          if (assetId) {
            const asset = await resolveImageAsset(assetId).catch(() => null);
            const contentType = safeString(asset?.contentType);
            const ext = extFromContentType(contentType || 'image/png');
            const blob = asset?.blob instanceof Blob ? asset.blob : undefined;

            const urlForConvert =
              asset && isHttpUrl(safeString(asset.url))
                ? safeString(asset.url)
                : await toPlaceholderUrl('asset', `asset:${assetId}`, ext);

            return {
              kind: 'syncnos_asset' as const,
              sourceUrl,
              urlForConvert,
              blob,
              contentType: contentType || undefined,
            };
          }

          if (isDataImageUrl(sourceUrl)) {
            const decoded = decodeDataUrlToBlob(sourceUrl);
            const contentType = safeString(decoded?.contentType);
            const ext = extFromContentType(contentType || 'image/png');
            const urlForConvert = await toPlaceholderUrl('data', sourceUrl, ext);
            return {
              kind: 'data' as const,
              sourceUrl,
              urlForConvert,
              blob: decoded?.blob,
              contentType: contentType || undefined,
            };
          }

          // Unknown scheme: keep as-is (Convert may ignore it).
          return { kind: 'http' as const, sourceUrl, urlForConvert: sourceUrl };
        })();

      cache.set(urlRaw, computed);
      const source = await computed;
      imageSourcesInOrder.push(source);

      const replacedUrl = match[2]?.trim().startsWith('<') ? `<${source.urlForConvert}>` : source.urlForConvert;
      const next = full.replace(match[2] || '', replacedUrl);
      parts.push(next);
      cursor = start + full.length;
    }

    parts.push(src.slice(cursor));
    return parts.join('');
  })();

  return { markdownForConvert, imageSourcesInOrder };
}

export default {
  preprocessFeishuDocxMarkdownImages,
};
