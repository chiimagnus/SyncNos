import { downloadImageSmart } from '@platform/webext/image-download-proxy';
import { fetchFeishuJson } from '@services/sync/feishu/feishu-api';
import type { FeishuMarkdownImageSource } from '@services/sync/feishu/docx/feishu-docx-image-preprocess';
import {
  bindImageBlockWithFileToken,
  FEISHU_DOCX_IMAGE_MAX_BYTES,
  guessFileNameFromUrl,
  uploadImageToFeishu,
} from '@services/sync/feishu/docx/image-materializer';

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function readHttpStatus(error: unknown): number {
  const e: any = error;
  const status = Number(e?.extra?.status ?? e?.status ?? 0) || 0;
  return status;
}

function readFeishuCode(error: unknown): string {
  const e: any = error;
  const code = e?.extra?.code;
  return code == null ? '' : String(code);
}

function readRetryAfterMs(error: unknown): number | undefined {
  const e: any = error;
  const ms = Number(e?.extra?.retryAfterMs ?? 0) || 0;
  return ms > 0 ? ms : undefined;
}

function shouldRetry(error: unknown): boolean {
  const status = readHttpStatus(error);
  const code = readFeishuCode(error);
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  if (status === 400 && code === '99991400') return true; // app rate limit
  return false;
}

function backoffMs(attempt: number, error: unknown): number {
  const retryAfter = readRetryAfterMs(error);
  if (retryAfter) return retryAfter;
  const base = 300 * Math.pow(3, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 120);
  return Math.min(10_000, Math.round(base + jitter));
}

async function withRetry<T>(fn: () => Promise<T>, { attempts }: { attempts: number }): Promise<T> {
  const max = Math.max(1, Math.min(3, Number(attempts) || 1));
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt >= max || !shouldRetry(e)) throw e;
      await sleep(backoffMs(attempt, e));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('retry failed');
}

function sanitizeUrlForWarning(url: string): string {
  const raw = safeString(url);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const keys = Array.from(new Set(Array.from(u.searchParams.keys()))).slice(0, 12);
    const q = keys.length ? `?keys=${keys.join(',')}` : '';
    return `${u.origin}${u.pathname}${q}`;
  } catch (_e) {
    return raw.slice(0, 140);
  }
}

function sanitizePotentialUrls(text: string): string {
  const src = safeString(text);
  if (!src) return '';
  return src.replace(/https?:\/\/[^\s)]+/gi, (matched) => sanitizeUrlForWarning(matched));
}

function readBlockId(block: any): string {
  if (!block || typeof block !== 'object') return '';
  return safeString(block.block_id ?? block.blockId ?? block.id);
}

function readBlockType(block: any): number {
  if (!block || typeof block !== 'object') return 0;
  return Number(block.block_type ?? block.blockType ?? 0) || 0;
}

async function listAllDocBlocks({ accessToken, docId }: { accessToken: string; docId: string }): Promise<any[]> {
  const out: any[] = [];
  let pageToken = '';
  for (let round = 0; round < 60; round += 1) {
    const qs = new URLSearchParams();
    qs.set('page_size', '500');
    if (pageToken) qs.set('page_token', pageToken);

    const data: any = await fetchFeishuJson(
      `/docx/v1/documents/${encodeURIComponent(docId)}/blocks?${qs.toString()}`,
      { method: 'GET' },
      { accessToken, retry: { attempts: 3 } },
    );

    const items =
      (Array.isArray(data?.items) ? data.items : null) ||
      (Array.isArray(data?.blocks) ? data.blocks : null) ||
      (Array.isArray(data?.data?.items) ? data.data.items : null) ||
      [];

    out.push(...items);

    const nextToken = safeString(data?.page_token ?? data?.next_page_token ?? data?.nextPageToken ?? '');
    const hasMoreRaw = data?.has_more ?? data?.hasMore;
    const hasMore = typeof hasMoreRaw === 'boolean' ? hasMoreRaw : !!nextToken;
    if (!hasMore || !nextToken) break;
    pageToken = nextToken;
  }
  return out;
}

function guessExtFromContentType(contentType: string): string {
  const ct = safeString(contentType).toLowerCase().split(';')[0] || '';
  if (ct === 'image/png') return 'png';
  if (ct === 'image/jpeg') return 'jpg';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/gif') return 'gif';
  if (ct === 'image/svg+xml') return 'svg';
  if (ct.startsWith('image/')) return ct.slice('image/'.length).replace(/[^a-z0-9]/gi, '') || 'png';
  return 'png';
}

export type FeishuDocxImageBindResult = {
  imageCount: number;
  docImageBlockCount: number;
  boundCount: number;
  warnings: string[];
};

/**
 * Best-effort: binds images by appearance order.
 *
 * IMPORTANT: Feishu image blocks do not keep original URLs; matching is done by index.
 */
export async function bindFeishuDocxImagesByOrder({
  accessToken,
  docId,
  imageSourcesInOrder,
}: {
  accessToken: string;
  docId: string;
  imageSourcesInOrder: FeishuMarkdownImageSource[];
}): Promise<FeishuDocxImageBindResult> {
  const sources = Array.isArray(imageSourcesInOrder) ? imageSourcesInOrder : [];
  if (!sources.length) return { imageCount: 0, docImageBlockCount: 0, boundCount: 0, warnings: [] };

  const blocks = await listAllDocBlocks({ accessToken, docId }).catch(() => []);
  const imageBlockIds = blocks
    .filter((b) => readBlockType(b) === 27)
    .map((b) => readBlockId(b))
    .filter(Boolean);

  const warnings: string[] = [];
  const maxPairs = Math.min(sources.length, imageBlockIds.length);

  if (imageBlockIds.length < sources.length) {
    warnings.push(`missing docx image blocks (${imageBlockIds.length}/${sources.length})`);
  } else if (imageBlockIds.length > sources.length) {
    warnings.push(`extra docx image blocks (${imageBlockIds.length - sources.length})`);
  }

  let boundCount = 0;
  for (let i = 0; i < maxPairs; i += 1) {
    const source = sources[i]!;
    const imageBlockId = imageBlockIds[i]!;
    const preferredUrl = safeString(source.sourceUrl) || safeString(source.urlForConvert);

    let blob: Blob | undefined = source.blob instanceof Blob ? source.blob : undefined;
    let contentType = safeString(source.contentType) || safeString(blob?.type);

    if (!blob && source.kind === 'syncnos_asset') {
      warnings.push(`local image unavailable: ${sanitizeUrlForWarning(source.urlForConvert)}`);
      continue;
    }

    if (!blob) {
      const dl = await downloadImageSmart({ url: preferredUrl, maxBytes: FEISHU_DOCX_IMAGE_MAX_BYTES }).catch(() => ({
        ok: false as const,
        reason: 'fetch' as const,
      }));
      if (!dl.ok) {
        warnings.push(`image download failed (${dl.reason}): ${sanitizeUrlForWarning(preferredUrl)}`);
        continue;
      }
      blob = dl.blob;
      contentType = safeString(dl.contentType) || contentType;
    }

    if (!blob) {
      warnings.push(`image missing blob: ${sanitizeUrlForWarning(preferredUrl)}`);
      continue;
    }

    if ((blob.size || 0) > FEISHU_DOCX_IMAGE_MAX_BYTES) {
      warnings.push(`image too large (>20MB): ${sanitizeUrlForWarning(preferredUrl)}`);
      continue;
    }

    const ext = guessExtFromContentType(contentType || 'image/png');
    const fileName =
      source.kind === 'http' ? guessFileNameFromUrl(preferredUrl, ext) : `image-${i + 1}.${ext || 'png'}`;

    try {
      const fileToken = await withRetry(() => uploadImageToFeishu({ accessToken, imageBlockId, fileName, blob }), {
        attempts: 3,
      });
      await withRetry(() => bindImageBlockWithFileToken({ accessToken, docId, imageBlockId, fileToken }), {
        attempts: 3,
      });
      boundCount += 1;
    } catch (e) {
      const msg = sanitizePotentialUrls(safeString((e as any)?.message || ''));
      warnings.push(`image bind failed: ${sanitizeUrlForWarning(preferredUrl)}${msg ? ` (${msg})` : ''}`);
    }

    // DocX write APIs are rate-limited; keep conservative pacing.
    await sleep(350);
  }

  return {
    imageCount: sources.length,
    docImageBlockCount: imageBlockIds.length,
    boundCount,
    warnings,
  };
}

export default {
  bindFeishuDocxImagesByOrder,
};
