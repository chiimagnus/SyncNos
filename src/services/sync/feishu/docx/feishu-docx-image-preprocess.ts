import { sha256Hex } from '@services/sync/shared/content-hash';
import { getImageCacheAssetsByIds, type ImageCacheAsset } from '@services/conversations/data/image-cache-read';
import {
  collectMarkdownImageReferences,
  replaceMarkdownImageReferences,
} from '@services/shared/markdown-image-references';
import { isSyncnosAssetUrl, parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(safeString(url));
}

function isDataImageUrl(url: string): boolean {
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?;base64,/i.test(safeString(url));
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

async function toPlaceholderUrl(prefix: string, stableKey: string, ext: string): Promise<string> {
  const hash = await sha256Hex(stableKey).catch(() => '');
  const id = hash ? hash.slice(0, 16) : String(Math.random()).slice(2);
  return `https://syncnos.invalid/${prefix}/${id}.${normalizeImageExt(ext)}`;
}

export async function preprocessFeishuDocxMarkdownImages(
  markdown: string,
  conversationId: number,
): Promise<FeishuMarkdownPreprocessResult> {
  const src = String(markdown || '');
  if (!src) return { markdownForConvert: '', imageSourcesInOrder: [] };

  const references = collectMarkdownImageReferences(src);
  if (!references.length) return { markdownForConvert: src, imageSourcesInOrder: [] };

  const localAssetIds: number[] = [];
  const seenLocalAssetIds = new Set<number>();
  for (const reference of references) {
    const assetId = parseSyncnosAssetId(reference.target);
    if (assetId == null || seenLocalAssetIds.has(assetId)) continue;
    seenLocalAssetIds.add(assetId);
    localAssetIds.push(assetId);
  }

  const scopedConversationId = Number(conversationId);
  const canReadLocalAssets = Number.isSafeInteger(scopedConversationId) && scopedConversationId > 0;
  const localAssets: Map<number, ImageCacheAsset> =
    localAssetIds.length && canReadLocalAssets
      ? await getImageCacheAssetsByIds({ ids: localAssetIds, conversationId: scopedConversationId }).catch(
          () => new Map<number, ImageCacheAsset>(),
        )
      : new Map<number, ImageCacheAsset>();

  const sourceByTarget = new Map<string, Promise<FeishuMarkdownImageSource>>();
  const resolveSource = (rawTarget: string): Promise<FeishuMarkdownImageSource> => {
    const sourceUrl = safeString(rawTarget);
    const cached = sourceByTarget.get(sourceUrl);
    if (cached) return cached;

    const computed = (async () => {
      if (isHttpUrl(sourceUrl)) return { kind: 'http' as const, sourceUrl, urlForConvert: sourceUrl };

      const assetId = parseSyncnosAssetId(sourceUrl);
      if (isSyncnosAssetUrl(sourceUrl)) {
        const asset = assetId != null ? localAssets.get(assetId) || null : null;
        const contentType = safeString(asset?.contentType);
        const ext = extFromContentType(contentType || 'image/png');
        const blob = asset?.blob instanceof Blob ? asset.blob : undefined;
        const stableKey = assetId != null ? `asset:${assetId}` : `asset-invalid:${sourceUrl}`;
        const urlForConvert =
          asset && isHttpUrl(safeString(asset.url))
            ? safeString(asset.url)
            : await toPlaceholderUrl('asset', stableKey, ext);
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

      return { kind: 'http' as const, sourceUrl, urlForConvert: sourceUrl };
    })();
    sourceByTarget.set(sourceUrl, computed);
    return computed;
  };

  const imageSourcesInOrder: FeishuMarkdownImageSource[] = [];
  const resolvedSourceByTarget = new Map<string, FeishuMarkdownImageSource>();
  for (const reference of references) {
    const source = await resolveSource(reference.target);
    imageSourcesInOrder.push(source);
    resolvedSourceByTarget.set(reference.target, source);
  }

  const markdownForConvert = replaceMarkdownImageReferences(src, references, (reference) => {
    const source = resolvedSourceByTarget.get(reference.target);
    return source ? { target: source.urlForConvert } : null;
  });
  return { markdownForConvert, imageSourcesInOrder };
}

export default {
  preprocessFeishuDocxMarkdownImages,
};
