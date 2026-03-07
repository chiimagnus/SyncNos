import { CURRENT_PAGE_MESSAGE_TYPES } from '../platform/messaging/message-contracts';

import type { CurrentPageCaptureService } from './current-page-capture';

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

export function registerCurrentPageCaptureContentHandlers(service: CurrentPageCaptureService) {
  const runtime = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
  const onMessage = runtime?.onMessage;
  if (!onMessage?.addListener) return () => {};

  const listener = (msg: any, _sender: any, sendResponse: (value: ApiResponse<any>) => void) => {
    if (!msg || typeof msg.type !== 'string') return undefined;

    if (msg.type === CURRENT_PAGE_MESSAGE_TYPES.GET_CAPTURE_STATE) {
      Promise.resolve()
        .then(() => service.getCurrentPageCaptureState())
        .then((data) => sendResponse(ok(data)))
        .catch((error) => sendResponse(err((error as any)?.message ?? error)));
      return true;
    }

    if (msg.type === CURRENT_PAGE_MESSAGE_TYPES.CAPTURE) {
      Promise.resolve()
        .then(() => service.captureCurrentPage())
        .then((data) => sendResponse(ok(data)))
        .catch((error) => sendResponse(err((error as any)?.message ?? error)));
      return true;
    }

    return undefined;
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
