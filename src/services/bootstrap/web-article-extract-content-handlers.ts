import { CONTENT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { extractWebArticleFromCurrentPage } from '@collectors/web/article-extract/engine';
import { err, ok, type ApiResponse } from '@services/bootstrap/content-handler-response';

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
