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

  const listener = (msg: any, _sender: any, sendResponse: (value: ApiResponse<any>) => void) => {
    const isStateQuery = msg?.type === CURRENT_PAGE_MESSAGE_TYPES.GET_CAPTURE_STATE;
    if (!isStateQuery && msg?.type !== CURRENT_PAGE_MESSAGE_TYPES.CAPTURE) return undefined;
    const run: () => Promise<unknown> = isStateQuery
      ? service.getCurrentPageCaptureState
      : () => {
          if (msg?.payload?.expectedUrl !== undefined && globalThis.location?.href !== msg.payload.expectedUrl) {
            throw Object.assign(new Error('Capture target changed'), { code: 'CAPTURE_TARGET_CHANGED' });
          }
          return service.captureCurrentPage();
        };

    options.localeReady
      .catch(() => undefined)
      .then(() => run())
      .then((data) => sendResponse(ok(data)))
      .catch((error) => {
        const code = (error as any)?.code;
        const status = Number((error as any)?.status);
        const safeCode =
          typeof code === 'string' && (code === 'CAPTURE_TARGET_CHANGED' || /^chatgpt_api_[a-z0-9_]+$/.test(code))
            ? code
            : '';
        sendResponse(
          err(
            (error as any)?.message ?? error,
            safeCode
              ? { code: safeCode, ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : null) }
              : undefined,
          ),
        );
      });
    return true;
  };

  onMessage.addListener(listener);

  return () => onMessage.removeListener?.(listener);
}
