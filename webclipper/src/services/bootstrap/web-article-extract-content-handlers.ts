import { CONTENT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { extractWebArticleFromCurrentPage } from '@collectors/web/article-extract/engine';

type ApiResponse<T> = {
  ok: boolean;
  data: T | null;
  error: { message: string; extra: unknown } | null;
};

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, error: null };
}

function err(message: unknown, extra?: unknown): ApiResponse<null> {
  return {
    ok: false,
    data: null,
    error: {
      message: String(message || 'unknown error'),
      extra: extra ?? null,
    },
  };
}

export function registerWebArticleExtractContentHandlers() {
  const runtime = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
  const onMessage = runtime?.onMessage;
  if (!onMessage?.addListener) return () => {};

  const listener = (msg: any, _sender: any, sendResponse: (value: ApiResponse<any>) => void) => {
    if (!msg || typeof msg.type !== 'string') return undefined;
    if (msg.type !== CONTENT_MESSAGE_TYPES.EXTRACT_WEB_ARTICLE) return undefined;

    Promise.resolve()
      .then(() =>
        extractWebArticleFromCurrentPage({
          stabilizationTimeoutMs: Number(msg?.payload?.stabilizationTimeoutMs) || undefined,
          stabilizationMinTextLength: Number(msg?.payload?.stabilizationMinTextLength) || undefined,
        }),
      )
      .then((data) => sendResponse(ok(data)))
      .catch((error) => sendResponse(err((error as any)?.message ?? error)));

    return true;
  };

  onMessage.addListener(listener);

  return () => {
    try {
      onMessage.removeListener?.(listener);
    } catch (_error) {
      // ignore remove failures
    }
  };
}

