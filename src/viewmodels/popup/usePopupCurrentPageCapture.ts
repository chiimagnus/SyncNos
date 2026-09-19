import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

export type PopupCaptureStatus = {
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

function statusFromCaptureState(state: CurrentPageCaptureState): PopupCaptureStatus | null {
  if (state.activity) {
    return {
      kind: state.activity.kind,
      message: state.activity.message,
    };
  }
  if (state.readiness === 'waiting') {
    return {
      kind: 'info',
      message: state.reason || buildCaptureWaitingMessage(state.collectorId),
    };
  }
  if (state.readiness === 'unsupported') {
    return {
      kind: 'error',
      message: state.reason || t('currentPageCannotBeCaptured'),
    };
  }
  return null;
}

export function usePopupCurrentPageCapture(input: { onCaptured?: () => void | Promise<void> }) {
  const onCaptured = input.onCaptured;
  const [captureState, setCaptureState] = useState<CurrentPageCaptureState | null>(null);
  const [checking, setChecking] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<PopupCaptureStatus | null>(null);
  const refreshStateInFlightRef = useRef<Promise<CurrentPageCaptureState> | null>(null);

  const refreshState = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setChecking(true);

    let request = refreshStateInFlightRef.current;
    if (!request) {
      request = send<ApiResponse<CurrentPageCaptureState>>(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE, {}).then(
        unwrap,
      );
      refreshStateInFlightRef.current = request;
    }

    try {
      const nextState = await request;
      setCaptureState(nextState);
      setStatus(statusFromCaptureState(nextState));
    } catch (error) {
      const message = (error as any)?.message ?? String(error ?? t('currentPageCannotBeCaptured'));
      setCaptureState(null);
      setStatus({ kind: 'error', message });
    } finally {
      if (refreshStateInFlightRef.current === request) refreshStateInFlightRef.current = null;
      if (!silent) setChecking(false);
    }
  }, []);

  const capture = useCallback(async () => {
    if (checking || fetching || captureState?.readiness !== 'ready' || captureState.activity?.phase === 'capturing') {
      return null;
    }

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
  }, [captureState?.activity?.phase, captureState?.readiness, checking, fetching, onCaptured, refreshState]);

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
    const activity = captureState?.activity;
    if (!activity || activity.phase !== 'settled' || activity.expiresAt == null) return;

    const delay = Math.max(0, activity.expiresAt - Date.now());
    const stateWithoutActivity = { ...captureState, activity: undefined };
    const timer = window.setTimeout(() => {
      setCaptureState((current) =>
        current?.activity?.expiresAt === activity.expiresAt ? { ...current, activity: undefined } : current,
      );
      setStatus((current) =>
        current?.message === activity.message ? statusFromCaptureState(stateWithoutActivity) : current,
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [captureState]);

  useEffect(() => {
    const observingExternalCapture = captureState?.activity?.phase === 'capturing';
    const waitingForReadiness = captureState?.readiness === 'waiting';
    if (checking || fetching || (!observingExternalCapture && !waitingForReadiness)) return;

    let cancelled = false;
    let timer: number | null = null;
    const delay = observingExternalCapture ? 300 : 1000;
    const poll = async () => {
      await refreshState({ silent: true });
      if (cancelled) return;
      timer = window.setTimeout(() => void poll(), delay);
    };
    timer = window.setTimeout(() => void poll(), delay);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [captureState?.activity?.phase, captureState?.readiness, checking, fetching, refreshState]);

  const buttonLabel = useMemo(() => {
    if (fetching) return t('fetchingDots');
    if (checking) return t('checkingDots');
    if (captureState?.activity?.message) return captureState.activity.message;
    if (captureState?.readiness === 'waiting') {
      return captureState.reason || buildCaptureWaitingMessage(captureState.collectorId);
    }
    return captureState?.label || t('unavailable');
  }, [captureState, checking, fetching]);

  const externalCaptureInProgress = captureState?.activity?.phase === 'capturing';

  return {
    buttonDisabled: checking || fetching || externalCaptureInProgress || captureState?.readiness !== 'ready',
    buttonLabel,
    capture,
    captureState,
    checking,
    status,
  };
}
