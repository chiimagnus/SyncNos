import { CHATGPT_ORIGIN, parseChatgptDurableConversationRoute } from '@services/shared/chatgpt-route';
import { buildChatgptApiSnapshot, type ChatgptApiSnapshotResult } from '@services/integrations/chatgpt/api-snapshot';

export type ChatgptApiCaptureResult = { applicable: false } | ({ applicable: true } & ChatgptApiSnapshotResult);

type FetchLike = typeof fetch;

function apiCaptureError(code: string, status?: number): Error & { code: string; status?: number } {
  return Object.assign(new Error(code), { code, ...(status ? { status } : null) });
}

async function fetchJson(input: {
  fetchFn: FetchLike;
  url: string;
  init: RequestInit;
  timeoutMs: number;
  errorPrefix: string;
}): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    let response: Response;
    try {
      response = await input.fetchFn(input.url, { ...input.init, signal: controller.signal });
    } catch (_error) {
      throw apiCaptureError(
        controller.signal.aborted ? `${input.errorPrefix}_timeout` : `${input.errorPrefix}_network`,
      );
    }
    if (!response.ok) throw apiCaptureError(`${input.errorPrefix}_http`, response.status);
    try {
      return await response.json();
    } catch (_error) {
      throw apiCaptureError(`${input.errorPrefix}_schema`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function sanitizedConversationUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.search = '';
  url.hash = '';
  return url.href;
}

export async function captureCurrentChatgptConversationViaApi(input?: {
  readCurrentUrl?: () => string;
  fallbackTitle?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  capturedAt?: number;
}): Promise<ChatgptApiCaptureResult> {
  const readCurrentUrl = input?.readCurrentUrl || (() => String(globalThis.location?.href || ''));
  const fetchFn = input?.fetchFn || fetch;
  const timeoutMs = Math.max(1, Number(input?.timeoutMs) || 30_000);
  const initialUrl = readCurrentUrl();
  const route = parseChatgptDurableConversationRoute(initialUrl);
  if (!route) return { applicable: false };

  const session = await fetchJson({
    fetchFn,
    url: `${CHATGPT_ORIGIN}/api/auth/session`,
    init: { method: 'GET', credentials: 'include' },
    timeoutMs,
    errorPrefix: 'chatgpt_api_session',
  });
  const accessToken = typeof session?.accessToken === 'string' ? session.accessToken.trim() : '';
  if (!accessToken) throw apiCaptureError('chatgpt_api_session_schema');

  const mapping = await fetchJson({
    fetchFn,
    url: `${CHATGPT_ORIGIN}/backend-api/conversation/${encodeURIComponent(route.conversationId)}`,
    init: {
      method: 'GET',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    timeoutMs,
    errorPrefix: 'chatgpt_api_mapping',
  });

  const currentRoute = parseChatgptDurableConversationRoute(readCurrentUrl());
  if (!currentRoute || currentRoute.conversationId !== route.conversationId) {
    throw apiCaptureError('chatgpt_api_navigation_changed');
  }

  return {
    applicable: true,
    ...buildChatgptApiSnapshot({
      data: mapping,
      conversationId: route.conversationId,
      conversationUrl: sanitizedConversationUrl(initialUrl),
      fallbackTitle: input?.fallbackTitle,
      capturedAt: input?.capturedAt,
    }),
  };
}
