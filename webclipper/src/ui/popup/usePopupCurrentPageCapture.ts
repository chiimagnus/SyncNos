import { useCallback, useEffect, useMemo, useState } from 'react';

import { UI_MESSAGE_TYPES } from '../../platform/messaging/message-contracts';
import { send } from '../../platform/runtime/runtime';
import { t } from '../../i18n';
import { buildCaptureSuccessTipMessage } from '../../shared/capture-tip';

type ApiResponse<T> = {
  ok: boolean;
  data: T | null;
  error: { message: string; extra: unknown } | null;
};

type CaptureState = {
  available: boolean;
  kind: 'chat' | 'article' | 'unsupported';
  label: string;
  collectorId: string | null;
  reason?: string;
};

type CaptureStatus = {
  kind: 'default' | 'error';
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
    available: false,
    kind: 'unsupported',
    label: t('unavailable'),
    collectorId: null,
    reason,
  };
}

export function usePopupCurrentPageCapture(input: {
  onCaptured?: () => void | Promise<void>;
}) {
  const onCaptured = input.onCaptured;
  const [captureState, setCaptureState] = useState<CaptureState>(() => unsupportedState(t('checkingCurrentPage')));
  const [checking, setChecking] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<CaptureStatus | null>(null);

  const refreshState = useCallback(async () => {
    setChecking(true);
    try {
      const response = await send<ApiResponse<CaptureState>>(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE, {});
      const nextState = unwrap(response);
      setCaptureState(nextState);
      setStatus(null);
      if (!nextState.available) {
        setStatus({ kind: 'error', message: nextState.reason || t('currentPageCannotBeCaptured') });
      }
    } catch (error) {
      const message = (error as any)?.message ?? String(error ?? t('currentPageCannotBeCaptured'));
      setCaptureState(unsupportedState(message));
      setStatus({ kind: 'error', message });
    } finally {
      setChecking(false);
    }
  }, []);

  const capture = useCallback(async () => {
    if (checking || fetching || !captureState.available) return null;

    setFetching(true);
    setStatus(null);
    try {
      const response = await send<ApiResponse<any>>(UI_MESSAGE_TYPES.CAPTURE_ACTIVE_TAB_CURRENT_PAGE, {});
      const data = unwrap(response);
      await onCaptured?.();
      await refreshState();
      setStatus({
        kind: 'default',
        message: buildCaptureSuccessTipMessage({ isNew: (data as any)?.isNew, title: (data as any)?.title }),
      });
      return data;
    } catch (error) {
      const message = (error as any)?.message ?? String(error ?? t('captureFailedFallback'));
      await refreshState();
      setStatus({ kind: 'error', message });
      throw error;
    } finally {
      setFetching(false);
    }
  }, [captureState.available, checking, fetching, onCaptured, refreshState]);

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

  const buttonLabel = useMemo(() => {
    if (fetching) return t('fetchingDots');
    if (checking) return t('checkingDots');
    return captureState.label || t('unavailable');
  }, [captureState.label, checking, fetching]);

  return {
    buttonDisabled: checking || fetching || !captureState.available,
    buttonLabel,
    capture,
    captureState,
    checking,
    fetching,
    refreshState,
    status,
  };
}
