import { CURRENT_PAGE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { err, ok, type ApiResponse } from '@services/bootstrap/content-handler-response';
import type { CurrentPageCaptureService } from '@services/bootstrap/current-page-capture';

type InpageTipApi = {
  showSaveTip?: (text: unknown, options?: { kind?: 'default' | 'error' }) => void;
};

type LocaleReadyOptions = {
  localeReady?: Promise<unknown>;
};

export function registerCurrentPageCaptureContentHandlers(
  service: CurrentPageCaptureService,
  options?: { inpageTip?: InpageTipApi | null } & LocaleReadyOptions,
) {
  const runtime = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
  const onMessage = runtime?.onMessage;
  if (!onMessage?.addListener) return () => {};

  const localeReady = options?.localeReady ?? Promise.resolve();
  const listener = (msg: any, _sender: any, sendResponse: (value: ApiResponse<any>) => void) => {
    if (!msg || typeof msg.type !== 'string') return undefined;

    if (msg.type === CURRENT_PAGE_MESSAGE_TYPES.GET_CAPTURE_STATE) {
      Promise.resolve(localeReady)
        .catch(() => undefined)
        .then(() => service.getCurrentPageCaptureState())
        .then((data) => sendResponse(ok(data)))
        .catch((error) => sendResponse(err((error as any)?.message ?? error)));
      return true;
    }

    if (msg.type === CURRENT_PAGE_MESSAGE_TYPES.CAPTURE) {
      const source = String(msg?.payload?.source || '')
        .trim()
        .toLowerCase();
      const inpageTip = options?.inpageTip;
      const showTip = source === 'contextmenu' && typeof inpageTip?.showSaveTip === 'function';

      Promise.resolve(localeReady)
        .catch(() => undefined)
        .then(() =>
          service.captureCurrentPage(
            showTip
              ? {
                  onProgress: (progress) => {
                    inpageTip?.showSaveTip?.(progress?.message, {
                      kind: progress?.kind === 'error' ? 'error' : 'default',
                    });
                  },
                }
              : undefined,
          ),
        )
        .then((data) => sendResponse(ok(data)))
        .catch((error) => {
          sendResponse(err((error as any)?.message ?? error));
        });
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
