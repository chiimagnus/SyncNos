import { downloadImagePlain } from '@platform/webext/image-download-proxy';
import { buildChatgptFileCacheKey, chatgptFileIdFromEstuaryUrl } from '@services/shared/chatgpt-image-identity';
import { CHATGPT_ORIGIN } from '@services/shared/chatgpt-route';
import type { ChatgptProtectedImageAsset, ChatgptProtectedImages } from '@services/integrations/chatgpt/api-snapshot';

export type ChatgptProtectedImageDownloadResult =
  | {
      cacheKey: string;
      ok: true;
      blob: Blob;
      byteSize: number;
      contentType: string;
    }
  | {
      cacheKey: string;
      ok: false;
      reason: 'session' | 'resolver' | 'download' | 'size_mismatch';
    };

type FetchLike = typeof fetch;

async function fetchWithTimeout(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      return await fetchFn(url, { ...init, signal: controller.signal });
    } catch (_error) {
      return null;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function readAccessToken(fetchFn: FetchLike, timeoutMs: number): Promise<string> {
  const response = await fetchWithTimeout(
    fetchFn,
    `${CHATGPT_ORIGIN}/api/auth/session`,
    { method: 'GET', credentials: 'include' },
    timeoutMs,
  );
  if (!response?.ok) return '';
  try {
    const session = await response.json();
    return typeof session?.accessToken === 'string' ? session.accessToken.trim() : '';
  } catch (_error) {
    return '';
  }
}

function resolverUrl(conversationKey: string, fileId: string): string {
  const url = new URL(`/backend-api/files/download/${encodeURIComponent(fileId)}`, CHATGPT_ORIGIN);
  url.searchParams.set('conversation_id', conversationKey);
  url.searchParams.set('download_intent', 'false');
  url.searchParams.set('include_library_file_state', 'true');
  url.searchParams.set('inline', 'false');
  return url.href;
}

function failed(
  asset: ChatgptProtectedImageAsset,
  reason: ChatgptProtectedImageDownloadResult & { ok: false },
): ChatgptProtectedImageDownloadResult {
  return { cacheKey: asset.cacheKey, ok: false, reason: reason.reason };
}

export async function downloadChatgptProtectedImages(
  bundle: ChatgptProtectedImages,
  options?: { fetchFn?: FetchLike; timeoutMs?: number },
): Promise<ChatgptProtectedImageDownloadResult[]> {
  const assets = Array.isArray(bundle?.assets) ? bundle.assets : [];
  if (!assets.length) return [];
  const fetchFn = options?.fetchFn || fetch;
  const timeoutMs = Math.max(1, Number(options?.timeoutMs) || 30_000);
  const accessToken = await readAccessToken(fetchFn, timeoutMs);
  if (!accessToken) return assets.map((asset) => ({ cacheKey: asset.cacheKey, ok: false, reason: 'session' }));

  const output: ChatgptProtectedImageDownloadResult[] = [];
  for (const asset of assets) {
    const expectedCacheKey = buildChatgptFileCacheKey(asset.fileId);
    if (!asset.fileId || !asset.cacheKey || asset.cacheKey !== expectedCacheKey) {
      output.push({ cacheKey: asset.cacheKey, ok: false, reason: 'resolver' });
      continue;
    }

    const response = await fetchWithTimeout(
      fetchFn,
      resolverUrl(bundle.conversationKey, asset.fileId),
      {
        method: 'GET',
        credentials: 'include',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      timeoutMs,
    );
    if (!response?.ok) {
      output.push(failed(asset, { cacheKey: asset.cacheKey, ok: false, reason: 'resolver' }));
      continue;
    }

    let resolver: any;
    try {
      resolver = await response.json();
    } catch (_error) {
      output.push(failed(asset, { cacheKey: asset.cacheKey, ok: false, reason: 'resolver' }));
      continue;
    }
    const downloadUrl = resolver?.download_url;
    if (chatgptFileIdFromEstuaryUrl(downloadUrl) !== asset.fileId) {
      output.push(failed(asset, { cacheKey: asset.cacheKey, ok: false, reason: 'resolver' }));
      continue;
    }

    const downloaded = await downloadImagePlain({ url: downloadUrl, maxBytes: Number.POSITIVE_INFINITY });
    if (!downloaded.ok) {
      output.push(failed(asset, { cacheKey: asset.cacheKey, ok: false, reason: 'download' }));
      continue;
    }
    const declaredSize = Number(resolver?.file_size_bytes);
    if (Number.isFinite(declaredSize) && declaredSize > 0 && declaredSize !== downloaded.byteSize) {
      output.push(failed(asset, { cacheKey: asset.cacheKey, ok: false, reason: 'size_mismatch' }));
      continue;
    }

    output.push({
      cacheKey: asset.cacheKey,
      ok: true,
      blob: downloaded.blob,
      byteSize: downloaded.byteSize,
      contentType: downloaded.contentType,
    });
  }
  return output;
}
