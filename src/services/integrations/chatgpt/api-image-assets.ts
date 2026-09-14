import { downloadImagePlain } from '@platform/webext/image-download-proxy';
import {
  buildChatgptFileCacheKey,
  chatgptFileIdFromEstuaryUrl,
  normalizeChatgptFileId,
} from '@services/shared/chatgpt-image-identity';
import { CHATGPT_ORIGIN } from '@services/shared/chatgpt-route';

type FetchLike = typeof fetch;

export type ChatgptImageUrlResolution =
  | { fileId: string; ok: true; url: string }
  | { fileId: string; ok: false; reason: 'session' | 'resolver' };

export type ChatgptImageDownloadResult =
  | { cacheKey: string; ok: true; blob: Blob; byteSize: number; contentType: string }
  | { cacheKey: string; ok: false; reason: 'session' | 'resolver' | 'download' };

async function fetchWithTimeout(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (_error) {
    return null;
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

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      output[index] = await task(items[index]!);
    }
  });
  await Promise.all(workers);
  return output;
}

function normalizeFileIds(values: Iterable<unknown>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const fileId = normalizeChatgptFileId(value);
    if (!fileId || seen.has(fileId)) continue;
    seen.add(fileId);
    output.push(fileId);
  }
  return output;
}

export async function resolveChatgptImageUrls(input: {
  conversationKey: string;
  fileIds: Iterable<unknown>;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  concurrency?: number;
}): Promise<ChatgptImageUrlResolution[]> {
  const conversationKey = String(input.conversationKey || '').trim();
  const fileIds = normalizeFileIds(input.fileIds);
  if (!conversationKey || !fileIds.length) return [];

  const fetchFn = input.fetchFn || fetch;
  const timeoutMs = Math.max(1, Number(input.timeoutMs) || 30_000);
  const concurrency = Math.max(1, Math.floor(Number(input.concurrency) || 4));
  const accessToken = await readAccessToken(fetchFn, timeoutMs);
  if (!accessToken) return fileIds.map((fileId) => ({ fileId, ok: false, reason: 'session' }));

  return await mapConcurrent(fileIds, concurrency, async (fileId): Promise<ChatgptImageUrlResolution> => {
    const response = await fetchWithTimeout(
      fetchFn,
      resolverUrl(conversationKey, fileId),
      {
        method: 'GET',
        credentials: 'include',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      timeoutMs,
    );
    if (!response?.ok) return { fileId, ok: false, reason: 'resolver' };

    let resolver: any;
    try {
      resolver = await response.json();
    } catch (_error) {
      return { fileId, ok: false, reason: 'resolver' };
    }
    const url = typeof resolver?.download_url === 'string' ? resolver.download_url.trim() : '';
    if (!url || chatgptFileIdFromEstuaryUrl(url) !== fileId) return { fileId, ok: false, reason: 'resolver' };
    return { fileId, ok: true, url };
  });
}

export async function downloadChatgptImages(input: {
  conversationKey: string;
  fileIds: Iterable<unknown>;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  concurrency?: number;
}): Promise<ChatgptImageDownloadResult[]> {
  const timeoutMs = Math.max(1, Number(input.timeoutMs) || 30_000);
  const concurrency = Math.max(1, Math.floor(Number(input.concurrency) || 4));
  const resolutions = await resolveChatgptImageUrls({ ...input, timeoutMs, concurrency });

  return await mapConcurrent(resolutions, concurrency, async (resolution): Promise<ChatgptImageDownloadResult> => {
    const cacheKey = buildChatgptFileCacheKey(resolution.fileId);
    if (!resolution.ok) {
      return { cacheKey, ok: false, reason: resolution.reason === 'session' ? 'session' : 'resolver' };
    }
    const downloaded = await downloadImagePlain({
      url: resolution.url,
      maxBytes: Number.POSITIVE_INFINITY,
      fetchFn: input.fetchFn,
      timeoutMs,
    });
    if (!downloaded.ok) return { cacheKey, ok: false, reason: 'download' };
    return {
      cacheKey,
      ok: true,
      blob: downloaded.blob,
      byteSize: downloaded.byteSize,
      contentType: downloaded.contentType,
    };
  });
}
