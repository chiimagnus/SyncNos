import * as notionFilesApi from '@services/sync/notion/notion-files-api.ts';
import {
  getImageCacheAssetsByIds,
  type ImageCacheAsset,
} from '@services/conversations/data/image-cache-read.ts';
import { parseSyncnosAssetId } from '@services/sync/shared/markdown-asset-refs';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function isDataImageUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  if (!text) return false;
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?;base64,/i.test(text);
}

function guessExtensionFromContentType(contentType: unknown): string {
  const ct = String(contentType || '')
    .trim()
    .toLowerCase();
  if (ct === 'image/png') return 'png';
  if (ct === 'image/jpeg') return 'jpg';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/gif') return 'gif';
  if (ct === 'image/svg+xml') return 'svg';
  return 'jpg';
}

function parseDataImageUrl(dataUrl: unknown) {
  const src = String(dataUrl || '').trim();
  const m = src.match(/^data:(image\/[a-z0-9.+-]+)(?:;charset=[a-z0-9._-]+)?;base64,(.*)$/i);
  if (!m) throw new Error('invalid data image url');
  const contentType = String(m[1] || '')
    .trim()
    .toLowerCase();
  if (!contentType || !contentType.startsWith('image/')) throw new Error('invalid data image content type');
  const payload = String(m[2] || '').trim();
  if (!payload) throw new Error('empty data image payload');
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const approxBytes = Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  if (approxBytes > MAX_IMAGE_BYTES) throw new Error(`image too large: ${approxBytes}`);

  function base64ToBytes(b64: unknown): Uint8Array {
    const raw = String(b64 || '');
    if (!raw) return new Uint8Array();
    if (typeof atob === 'function') {
      const bin = atob(raw);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      return out;
    }
    if (typeof Buffer !== 'undefined') {
      try {
        const buf = Buffer.from(raw, 'base64');
        return new Uint8Array(buf);
      } catch (_e) {
        return new Uint8Array();
      }
    }
    return new Uint8Array();
  }

  const bytes = base64ToBytes(payload);
  if (!bytes.byteLength) throw new Error('data image decoded empty');
  return { bytes, contentType };
}

function paragraphBlock(text: unknown) {
  const content = String(text || '').trim();
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: content || '[Image omitted]' } }] },
  };
}

function sanitizeUrlForLog(url: unknown): string {
  try {
    const u = new URL(String(url || ''));
    const keys = [];
    for (const [k] of u.searchParams.entries()) keys.push(k);
    const uniqueKeys = Array.from(new Set(keys));
    const q = uniqueKeys.length ? `?keys=${uniqueKeys.slice(0, 12).join(',')}` : '';
    return `${u.origin}${u.pathname}${q}`;
  } catch (_e) {
    return String(url || '').slice(0, 120);
  }
}

function guessContentTypeFromUrl(url: unknown): string {
  const s = String(url || '').toLowerCase();
  if (s.includes('.png')) return 'image/png';
  if (s.includes('.jpg') || s.includes('.jpeg')) return 'image/jpeg';
  if (s.includes('.webp')) return 'image/webp';
  if (s.includes('.gif')) return 'image/gif';
  if (s.includes('.svg')) return 'image/svg+xml';
  return '';
}

function guessFilenameFromUrl(url: unknown): string {
  return notionFilesApi.guessFilenameFromUrl(url);
}

async function downloadBytes(url: unknown) {
  if (typeof fetch !== 'function') throw new Error('fetch missing');
  const target = String(url || '').trim();
  let credentials: RequestCredentials = 'include';
  try {
    const u = new URL(target);
    // Attachment URLs may require Notion auth cookies on `notion.so`.
    // The redirected CDN (`notionusercontent.com`) should work without credentials.
    if (/(\.|^)notionusercontent\.com$/i.test(u.hostname)) credentials = 'omit';
  } catch (_e) {
    // ignore
  }
  const res = await fetch(target, {
    method: 'GET',
    redirect: 'follow',
    credentials,
    cache: 'no-store',
    headers: { Accept: 'image/*,*/*;q=0.8' },
  });
  if (!res.ok) {
    const finalUrl = res && res.url ? String(res.url) : target;
    throw new Error(`image download failed HTTP ${res.status} ${sanitizeUrlForLog(finalUrl)}`);
  }
  const ct = res.headers && res.headers.get ? String(res.headers.get('content-type') || '') : '';
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  return { bytes, contentType: ct.split(';')[0].trim(), contentLength: bytes.byteLength };
}

function toFileUploadImageBlock(block: any, uploadId: unknown) {
  return {
    ...block,
    type: 'image',
    image: {
      type: 'file_upload',
      file_upload: { id: uploadId },
    },
  };
}

async function uploadFromExternalUrl(files: any, accessToken: string, url: unknown) {
  const created = await files.createExternalURLUpload({ accessToken, url });
  const id = created && created.id ? String(created.id).trim() : '';
  if (!id) throw new Error('missing file upload id');
  const ready = await files.waitUntilUploaded({ accessToken, id });
  return ready && ready.id ? String(ready.id).trim() : id;
}

async function uploadFromBytes(files: any, accessToken: string, url: unknown) {
  const dl = await downloadBytes(url);
  if (!dl || !(dl.bytes instanceof Uint8Array) || !dl.bytes.byteLength) throw new Error('download empty');
  if (dl.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`image too large: ${dl.bytes.byteLength}`);
  const ct = dl.contentType || guessContentTypeFromUrl(url) || 'application/octet-stream';
  const filename = guessFilenameFromUrl(url);
  const up = await files.createFileUpload({
    accessToken,
    filename,
    contentType: ct,
  });
  const fileId = up && up.id ? String(up.id).trim() : '';
  if (!fileId) throw new Error('missing file upload id');
  await files.sendFileUpload({ accessToken, id: fileId, bytes: dl.bytes, filename, contentType: ct });
  const ready = await files.waitUntilUploaded({ accessToken, id: fileId });
  return ready && ready.id ? String(ready.id).trim() : fileId;
}

async function uploadFromDataUrl(files: any, accessToken: string, dataUrl: unknown) {
  const parsed = parseDataImageUrl(dataUrl);
  const bytes = parsed.bytes;
  const contentType = parsed.contentType || 'application/octet-stream';
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`image too large: ${bytes.byteLength}`);

  const ext = guessExtensionFromContentType(contentType);
  const filename = `image.${ext}`;
  const up = await files.createFileUpload({
    accessToken,
    filename,
    contentType,
  });
  const fileId = up && up.id ? String(up.id).trim() : '';
  if (!fileId) throw new Error('missing file upload id');
  await files.sendFileUpload({ accessToken, id: fileId, bytes, filename, contentType });
  const ready = await files.waitUntilUploaded({ accessToken, id: fileId });
  return ready && ready.id ? String(ready.id).trim() : fileId;
}

async function uploadFromSyncnosAsset(
  files: any,
  accessToken: string,
  assetId: number,
  asset: ImageCacheAsset | null,
) {
  if (!asset || !(asset.blob instanceof Blob)) throw new Error(`missing local asset blob: ${assetId}`);

  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  if (!bytes.byteLength) throw new Error('local asset bytes empty');
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`image too large: ${bytes.byteLength}`);

  const contentType =
    String(asset.contentType || asset.blob.type || guessContentTypeFromUrl(asset.url) || '').trim() ||
    'application/octet-stream';
  const ext = guessExtensionFromContentType(contentType);
  const filename = `image-${assetId}.${ext}`;

  const up = await files.createFileUpload({
    accessToken,
    filename,
    contentType,
  });
  const fileId = up && up.id ? String(up.id).trim() : '';
  if (!fileId) throw new Error('missing file upload id');
  await files.sendFileUpload({ accessToken, id: fileId, bytes, filename, contentType });
  const ready = await files.waitUntilUploaded({ accessToken, id: fileId });
  return ready && ready.id ? String(ready.id).trim() : fileId;
}

async function upgradeImageBlocksToFileUploads(accessToken: string, blocks: any) {
  const list = Array.isArray(blocks) ? blocks : [];
  if (!list.length) return [];
  const files = notionFilesApi;
  const localAssetIds: number[] = [];
  const seenLocalAssetIds = new Set<number>();
  for (const block of list) {
    if (!block || block.type !== 'image' || !block.image || block.image.type !== 'external') continue;
    const url = block.image?.external?.url ? String(block.image.external.url).trim() : '';
    const assetId = parseSyncnosAssetId(url);
    if (assetId == null || seenLocalAssetIds.has(assetId)) continue;
    seenLocalAssetIds.add(assetId);
    localAssetIds.push(assetId);
  }
  const localAssets: Map<number, ImageCacheAsset> = localAssetIds.length
    ? await getImageCacheAssetsByIds({ ids: localAssetIds }).catch(() => new Map<number, ImageCacheAsset>())
    : new Map<number, ImageCacheAsset>();
  const cache = new Map<string, string>();
  const out: any[] = [];

  for (const b of list) {
    if (!b || b.type !== 'image' || !b.image || b.image.type !== 'external') {
      out.push(b);
      continue;
    }
    const url = b.image && b.image.external && b.image.external.url ? String(b.image.external.url).trim() : '';
    if (!url) {
      out.push(b);
      continue;
    }

    const assetId = parseSyncnosAssetId(url);
    let uploadId = cache.get(url) || '';
    if (!uploadId) {
      if (isDataImageUrl(url)) {
        try {
          uploadId = await uploadFromDataUrl(files, accessToken, url);
          if (uploadId) cache.set(url, uploadId);
        } catch (e) {
          const msg = e && (e as any).message ? String((e as any).message) : String(e);
          try {
            console.warn('[NotionImageUpload] data_url upload failed:', msg);
          } catch (_e2) {
            // ignore
          }
          uploadId = '';
        }
      } else if (assetId != null) {
        try {
          uploadId = await uploadFromSyncnosAsset(files, accessToken, assetId, localAssets.get(assetId) || null);
          if (uploadId) cache.set(url, uploadId);
        } catch (e) {
          const msg = e && (e as any).message ? String((e as any).message) : String(e);
          try {
            console.warn('[NotionImageUpload] syncnos_asset upload failed:', url, msg);
          } catch (_e2) {
            // ignore
          }
          uploadId = '';
        }
      } else {
        try {
          uploadId = await uploadFromExternalUrl(files, accessToken, url);
          if (uploadId) cache.set(url, uploadId);
        } catch (e) {
          const brief = sanitizeUrlForLog(url);
          const msg = e && (e as any).message ? String((e as any).message) : String(e);
          try {
            console.warn('[NotionImageUpload] external_url failed:', brief, msg);
          } catch (_e2) {
            // ignore
          }
          try {
            uploadId = await uploadFromBytes(files, accessToken, url);
            if (uploadId) cache.set(url, uploadId);
          } catch (e2) {
            const msg2 = e2 && (e2 as any).message ? String((e2 as any).message) : String(e2);
            try {
              console.warn('[NotionImageUpload] byte upload failed:', brief, msg2);
            } catch (_e3) {
              // ignore
            }
            uploadId = '';
          }
        }
      }
    }

    if (!uploadId) {
      if (isDataImageUrl(url) || assetId != null) {
        out.push(paragraphBlock('[Image omitted: local image upload failed]'));
      } else out.push(b);
      continue;
    }

    out.push(toFileUploadImageBlock(b, uploadId));
  }

  return out;
}

export { upgradeImageBlocksToFileUploads };
