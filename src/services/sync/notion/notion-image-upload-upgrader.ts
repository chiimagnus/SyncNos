import * as notionFilesApi from '@services/sync/notion/notion-files-api.ts';
import { getImageCacheAssetsByIds, type ImageCacheAsset } from '@services/conversations/data/image-cache-read.ts';
import { isSyncnosAssetUrl, parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';

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

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (!bytes.byteLength) throw new Error('data image decoded empty');
  return { bytes, contentType };
}

function paragraphBlock(content: string) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content } }] },
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

async function downloadBytes(url: string) {
  const target = url.trim();
  const hostname = new URL(target).hostname;
  // Attachment URLs may require Notion auth cookies on `notion.so`.
  // The redirected CDN (`notionusercontent.com`) should work without credentials.
  const credentials: RequestCredentials = /(\.|^)notionusercontent\.com$/i.test(hostname) ? 'omit' : 'include';
  const res = await fetch(target, {
    method: 'GET',
    redirect: 'follow',
    credentials,
    cache: 'no-store',
    headers: { Accept: 'image/*,*/*;q=0.8' },
  });
  if (!res.ok) {
    const finalUrl = res.url ? String(res.url) : target;
    throw new Error(`image download failed HTTP ${res.status} ${sanitizeUrlForLog(finalUrl)}`);
  }
  const ct = String(res.headers.get('content-type') || '');
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  return { bytes, contentType: ct.split(';')[0].trim() };
}

function toFileUploadImageBlock(block: any, uploadId: string) {
  return {
    ...block,
    image: {
      type: 'file_upload',
      file_upload: { id: uploadId },
    },
  };
}

async function uploadFromExternalUrl(accessToken: string, url: string) {
  const created = await notionFilesApi.createExternalURLUpload({ accessToken, url });
  const id = created && created.id ? String(created.id).trim() : '';
  if (!id) throw new Error('missing file upload id');
  await notionFilesApi.waitUntilUploaded({ accessToken, id });
  return id;
}

async function uploadFromBytes(accessToken: string, url: string) {
  const dl = await downloadBytes(url);
  if (!dl.bytes.byteLength) throw new Error('download empty');
  if (dl.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`image too large: ${dl.bytes.byteLength}`);
  const ct = dl.contentType || guessContentTypeFromUrl(url) || 'application/octet-stream';
  const filename = notionFilesApi.guessFilenameFromUrl(url);
  const up = await notionFilesApi.createFileUpload({
    accessToken,
    filename,
    contentType: ct,
  });
  const fileId = up && up.id ? String(up.id).trim() : '';
  if (!fileId) throw new Error('missing file upload id');
  await notionFilesApi.sendFileUpload({ accessToken, id: fileId, bytes: dl.bytes, filename, contentType: ct });
  await notionFilesApi.waitUntilUploaded({ accessToken, id: fileId });
  return fileId;
}

async function uploadFromDataUrl(accessToken: string, dataUrl: string) {
  const parsed = parseDataImageUrl(dataUrl);
  const bytes = parsed.bytes;
  const contentType = parsed.contentType;
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`image too large: ${bytes.byteLength}`);

  const ext = guessExtensionFromContentType(contentType);
  const filename = `image.${ext}`;
  const up = await notionFilesApi.createFileUpload({
    accessToken,
    filename,
    contentType,
  });
  const fileId = up && up.id ? String(up.id).trim() : '';
  if (!fileId) throw new Error('missing file upload id');
  await notionFilesApi.sendFileUpload({ accessToken, id: fileId, bytes, filename, contentType });
  await notionFilesApi.waitUntilUploaded({ accessToken, id: fileId });
  return fileId;
}

async function uploadFromSyncnosAsset(accessToken: string, assetId: number, asset: ImageCacheAsset | null) {
  if (!asset || !(asset.blob instanceof Blob)) throw new Error(`missing local asset blob: ${assetId}`);

  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  if (!bytes.byteLength) throw new Error('local asset bytes empty');
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`image too large: ${bytes.byteLength}`);

  const contentType =
    String(asset.contentType || asset.blob.type || guessContentTypeFromUrl(asset.url) || '').trim() ||
    'application/octet-stream';
  const ext = guessExtensionFromContentType(contentType);
  const filename = `image-${assetId}.${ext}`;

  const up = await notionFilesApi.createFileUpload({
    accessToken,
    filename,
    contentType,
  });
  const fileId = up && up.id ? String(up.id).trim() : '';
  if (!fileId) throw new Error('missing file upload id');
  await notionFilesApi.sendFileUpload({ accessToken, id: fileId, bytes, filename, contentType });
  await notionFilesApi.waitUntilUploaded({ accessToken, id: fileId });
  return fileId;
}

async function upgradeImageBlocksToFileUploads(accessToken: string, blocks: any[], conversationId: number) {
  const localAssetIds: number[] = [];
  const seenLocalAssetIds = new Set<number>();
  for (const block of blocks) {
    if (block?.type !== 'image' || block.image?.type !== 'external') continue;
    const url = String(block.image.external?.url || '').trim();
    const assetId = parseSyncnosAssetId(url);
    if (assetId == null || seenLocalAssetIds.has(assetId)) continue;
    seenLocalAssetIds.add(assetId);
    localAssetIds.push(assetId);
  }
  const localAssets: Map<number, ImageCacheAsset> = localAssetIds.length
    ? await getImageCacheAssetsByIds({ ids: localAssetIds, conversationId }).catch(
        () => new Map<number, ImageCacheAsset>(),
      )
    : new Map<number, ImageCacheAsset>();
  const cache = new Map<string, string>();
  const out: any[] = [];

  for (const b of blocks) {
    if (b?.type !== 'image' || b.image?.type !== 'external') {
      out.push(b);
      continue;
    }
    const url = String(b.image.external?.url || '').trim();
    if (!url) {
      out.push(b);
      continue;
    }

    const assetId = parseSyncnosAssetId(url);
    const isInternalAsset = isSyncnosAssetUrl(url);
    const isDataImage = isDataImageUrl(url);
    let uploadId = cache.get(url) || '';
    if (!uploadId) {
      if (isDataImage) {
        try {
          uploadId = await uploadFromDataUrl(accessToken, url);
          cache.set(url, uploadId);
        } catch (e) {
          const msg = e && (e as any).message ? String((e as any).message) : String(e);
          console.warn('[NotionImageUpload] data_url upload failed:', msg);
        }
      } else if (isInternalAsset) {
        if (assetId != null) {
          try {
            uploadId = await uploadFromSyncnosAsset(accessToken, assetId, localAssets.get(assetId) || null);
            cache.set(url, uploadId);
          } catch (e) {
            const msg = e && (e as any).message ? String((e as any).message) : String(e);
            console.warn('[NotionImageUpload] syncnos_asset upload failed:', assetId, msg);
          }
        }
      } else {
        try {
          uploadId = await uploadFromExternalUrl(accessToken, url);
          cache.set(url, uploadId);
        } catch (e) {
          const brief = sanitizeUrlForLog(url);
          const msg = e && (e as any).message ? String((e as any).message) : String(e);
          console.warn('[NotionImageUpload] external_url failed:', brief, msg);
          try {
            uploadId = await uploadFromBytes(accessToken, url);
            cache.set(url, uploadId);
          } catch (e2) {
            const msg2 = e2 && (e2 as any).message ? String((e2 as any).message) : String(e2);
            console.warn('[NotionImageUpload] byte upload failed:', brief, msg2);
          }
        }
      }
    }

    if (!uploadId) {
      if (isDataImage || isInternalAsset) {
        out.push(paragraphBlock('[Image omitted: local image upload failed]'));
      } else out.push(b);
      continue;
    }

    out.push(toFileUploadImageBlock(b, uploadId));
  }

  return out;
}

export { upgradeImageBlocksToFileUploads };
