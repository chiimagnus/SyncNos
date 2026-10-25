import { CURRENT_PAGE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { err, ok, type ApiResponse } from '@services/bootstrap/content-handler-response';
import type { CurrentPageCaptureService } from '@services/bootstrap/current-page-capture';

type CurrentPageCaptureContentHandlerOptions = {
  localeReady: Promise<unknown>;
};

export function registerCurrentPageCaptureContentHandlers(
  service: Pick<CurrentPageCaptureService, 'getCurrentPageCaptureState' | 'captureCurrentPage'>,
  options: CurrentPageCaptureContentHandlerOptions,
) {
  const runtime = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
  const onMessage = runtime?.onMessage;
  if (!onMessage?.addListener) return () => {};

  const localeReady = options.localeReady;
  const listener = (msg: any, _sender: any, sendResponse: (value: ApiResponse<any>) => void) => {
    if (!msg || typeof msg.type !== 'string') return undefined;

    if (msg.type === CURRENT_PAGE_MESSAGE_TYPES.GET_CAPTURE_STATE) {
      localeReady
        .catch(() => undefined)
        .then(() => service.getCurrentPageCaptureState())
        .then((data) => sendResponse(ok(data)))
        .catch((error) => sendResponse(err((error as any)?.message ?? error)));
      return true;
    }

    if (msg.type === CURRENT_PAGE_MESSAGE_TYPES.CAPTURE) {
      localeReady
        .catch(() => undefined)
        .then(() => service.captureCurrentPage())
        .then((data) => sendResponse(ok(data)))
        .catch((error) => {
          sendResponse(err((error as any)?.message ?? error));
        });
      return true;
    }

    return undefined;
  };

  onMessage.addListener(listener);

  return () => onMessage.removeListener?.(listener);
}
