import { useCallback, useEffect, useMemo, useState } from 'react';

import { UI_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { send } from '@services/shared/runtime';
import { t } from '@i18n';
import { buildCaptureSuccessTipMessage } from '@services/shared/capture-tip';
import {
  buildCaptureWaitingMessage,
  buildPartialCaptureMessage,
} from '@services/bootstrap/current-page-capture-status';
import type { CurrentPageCaptureResult, CurrentPageCaptureState } from '@services/bootstrap/current-page-capture';

type ApiResponse<T> = {
  ok: boolean;
  data: T | null;
  error: { message: string; extra: unknown } | null;
};

type PopupCaptureStatus = {
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
};

function unwrap<T>(response: ApiResponse<T>): T {
  if (!response || typeof response.ok !== 'boolean') {
    throw new Error('no response from background');
  }
  if (response.ok) return response.data as T;
  throw new Error(response.error?.message || 'unknown error');
}

export function usePopupCurrentPageCapture(input: { onCaptured?: () => void | Promise<void> }) {
  const onCaptured = input.onCaptured;
  const [captureState, setCaptureState] = useState<CurrentPageCaptureState | null>(null);
  const [checking, setChecking] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<PopupCaptureStatus | null>(null);

  const refreshState = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setChecking(true);
    try {
      const response = await send<ApiResponse<CurrentPageCaptureState>>(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE, {});
      const nextState = unwrap(response);
      setCaptureState(nextState);
      if (nextState.readiness === 'waiting') {
        setStatus({
          kind: 'info',
          message: nextState.reason || buildCaptureWaitingMessage(nextState.collectorId),
        });
      } else if (nextState.readiness === 'unsupported') {
        setStatus({
          kind: 'error',
          message: nextState.reason || t('currentPageCannotBeCaptured'),
        });
      } else {
        setStatus(null);
      }
    } catch (error) {
      const message = (error as any)?.message ?? String(error ?? t('currentPageCannotBeCaptured'));
      setCaptureState(null);
      setStatus({ kind: 'error', message });
    } finally {
      if (!silent) setChecking(false);
    }
  }, []);

  const capture = useCallback(async () => {
    if (checking || fetching || captureState?.readiness !== 'ready') return null;

    setFetching(true);
    setStatus({ kind: 'info', message: t('fetchingDots') });
    try {
      const response = await send<ApiResponse<CurrentPageCaptureResult>>(
        UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE,
        {},
      );
      const data = unwrap(response);
      await onCaptured?.();
      await refreshState({ silent: true });
      if (data.kind === 'chat' && data.captureCompleteness === 'partial') {
        setStatus({
          kind: 'warning',
          message: buildPartialCaptureMessage(data.captureReasons),
        });
      } else {
        setStatus({
          kind: 'success',
          message:
            data.kind === 'video' && data.subtitleStatus === 'empty'
              ? t('videoTranscriptTipNoSubtitles')
              : buildCaptureSuccessTipMessage({ isNew: data.isNew, title: data.title }),
        });
      }
      return data;
    } catch (error) {
      const message = (error as any)?.message ?? String(error ?? t('captureFailedFallback'));
      await refreshState({ silent: true });
      setStatus({ kind: 'error', message });
      throw error;
    } finally {
      setFetching(false);
    }
  }, [captureState?.readiness, checking, fetching, onCaptured, refreshState]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    const onFocus = () => {
      void refreshState();
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshState]);

  useEffect(() => {
    if (checking || fetching || captureState?.readiness !== 'waiting') return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      await refreshState({ silent: true });
      if (cancelled) return;
      timer = window.setTimeout(() => void poll(), 1000);
    };
    timer = window.setTimeout(() => void poll(), 1000);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [captureState?.readiness, checking, fetching, refreshState]);

  const buttonLabel = useMemo(() => {
    if (fetching) return t('fetchingDots');
    if (checking) return t('checkingDots');
    if (captureState?.readiness === 'waiting') {
      return captureState.reason || buildCaptureWaitingMessage(captureState.collectorId);
    }
    return captureState?.label || t('unavailable');
  }, [captureState, checking, fetching]);

  return {
    buttonDisabled: checking || fetching || captureState?.readiness !== 'ready',
    buttonLabel,
    capture,
    status,
  };
}
