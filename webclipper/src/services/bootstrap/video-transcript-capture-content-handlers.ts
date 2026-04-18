import { CONTENT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import type { VideoTranscriptCaptureService } from '@services/bootstrap/video-transcript-capture';
import { t } from '@i18n';
import { buildCaptureSuccessTipMessage } from '@services/shared/capture-tip';

type ApiResponse<T> = {
  ok: boolean;
  data: T | null;
  error: { message: string; extra: unknown } | null;
};

type InpageTipApi = {
  showSaveTip?: (text: unknown, options?: { kind?: 'default' | 'error' }) => void;
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

function toErrorMessage(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const text = String(msg || '').trim();
  return text || fallback;
}

export function registerVideoTranscriptCaptureContentHandlers(
  service: VideoTranscriptCaptureService,
  options?: { inpageTip?: InpageTipApi | null },
) {
  const runtime = (globalThis as any).chrome?.runtime ?? (globalThis as any).browser?.runtime;
  const onMessage = runtime?.onMessage;
  if (!onMessage?.addListener) return () => {};

  const listener = (msg: any, _sender: any, sendResponse: (value: ApiResponse<any>) => void) => {
    if (!msg || typeof msg.type !== 'string') return undefined;
    if (msg.type !== CONTENT_MESSAGE_TYPES.CAPTURE_VIDEO_TRANSCRIPT) return undefined;

    const source = String(msg?.payload?.source || '')
      .trim()
      .toLowerCase();
    const inpageTip = options?.inpageTip;
    const showTip = source === 'contextmenu' && typeof inpageTip?.showSaveTip === 'function';

    if (showTip) inpageTip?.showSaveTip?.(t('fetchingDots'), { kind: 'default' });

    Promise.resolve()
      .then(() => service.captureVideoTranscript())
      .then((data) => {
        if (showTip) {
          const suffix = data?.subtitleStatus === 'empty' ? t('videoTranscriptTipNoSubtitlesSuffix') : '';
          inpageTip?.showSaveTip?.(
            buildCaptureSuccessTipMessage({ isNew: data?.isNew, title: data?.title, suffix }),
            { kind: 'default' },
          );
        }
        sendResponse(ok(data));
      })
      .catch((error) => {
        if (showTip) inpageTip?.showSaveTip?.(toErrorMessage(error, t('captureFailedFallback')), { kind: 'error' });
        sendResponse(err((error as any)?.message ?? error));
      });

    return true;
  };

  onMessage.addListener(listener);

  return () => {
    try {
      onMessage.removeListener?.(listener);
    } catch (_error) {
      // ignore
    }
  };
}
