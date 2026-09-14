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

type CaptureState = CurrentPageCaptureState;

export type PopupCapturePhase =
  | 'checking'
  | 'waiting'
  | 'ready'
  | 'capturing'
  | 'saved'
  | 'saved-partial'
  | 'unsupported'
  | 'error';

export type PopupCaptureStatus = {
  phase: Exclude<PopupCapturePhase, 'checking' | 'ready'>;
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

function unsupportedState(reason: string): CaptureState {
  return {
    readiness: 'unsupported',
    kind: 'unsupported',
    label: t('unavailable'),
    collectorId: null,
    reason,
  };
}

export function usePopupCurrentPageCapture(input: { onCaptured?: () => void | Promise<void> }) {
  const onCaptured = input.onCaptured;
  const [captureState, setCaptureState] = useState<CaptureState>(() => unsupportedState(t('checkingCurrentPage')));
  const [checking, setChecking] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<PopupCaptureStatus | null>(null);

  const refreshState = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setChecking(true);
    try {
      const response = await send<ApiResponse<CaptureState>>(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE, {});
      const nextState = unwrap(response);
      setCaptureState(nextState);
      if (nextState.readiness === 'waiting') {
        setStatus({
          phase: 'waiting',
          kind: 'info',
          message: nextState.reason || buildCaptureWaitingMessage(nextState.collectorId),
        });
      } else if (nextState.readiness === 'unsupported') {
        setStatus({
          phase: 'unsupported',
          kind: 'error',
          message: nextState.reason || t('currentPageCannotBeCaptured'),
        });
      } else {
        setStatus(null);
      }
    } catch (error) {
      const message = (error as any)?.message ?? String(error ?? t('currentPageCannotBeCaptured'));
      setCaptureState(unsupportedState(message));
      setStatus({ phase: 'error', kind: 'error', message });
    } finally {
      if (!silent) setChecking(false);
    }
  }, []);

  const capture = useCallback(async () => {
    if (checking || fetching || captureState.readiness !== 'ready') return null;

    setFetching(true);
    setStatus({ phase: 'capturing', kind: 'info', message: t('fetchingDots') });
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
          phase: 'saved-partial',
          kind: 'warning',
          message: buildPartialCaptureMessage(data.captureReasons),
        });
      } else {
        setStatus({
          phase: 'saved',
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
      setStatus({ phase: 'error', kind: 'error', message });
      throw error;
    } finally {
      setFetching(false);
    }
  }, [captureState.readiness, checking, fetching, onCaptured, refreshState]);

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
    if (checking || fetching || captureState.readiness !== 'waiting') return;
    const timer = window.setInterval(() => {
      void refreshState({ silent: true });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [captureState.readiness, checking, fetching, refreshState]);

  const buttonLabel = useMemo(() => {
    if (fetching) return t('fetchingDots');
    if (checking) return t('checkingDots');
    if (captureState.readiness === 'waiting') {
      return captureState.reason || buildCaptureWaitingMessage(captureState.collectorId);
    }
    return captureState.label || t('unavailable');
  }, [captureState.collectorId, captureState.label, captureState.readiness, captureState.reason, checking, fetching]);

  const phase: PopupCapturePhase = checking
    ? 'checking'
    : fetching
      ? 'capturing'
      : status?.phase || (captureState.readiness === 'ready' ? 'ready' : captureState.readiness);

  return {
    buttonDisabled: checking || fetching || captureState.readiness !== 'ready',
    buttonLabel,
    capture,
    captureState,
    checking,
    fetching,
    phase,
    refreshState,
    status,
  };
}
