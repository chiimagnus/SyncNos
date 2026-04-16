import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { UI_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { send } from '@services/shared/runtime';
import { t } from '@i18n';

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

function unwrap<T>(response: ApiResponse<T>): T {
  if (!response || typeof response.ok !== 'boolean') {
    throw new Error('no response from background');
  }
  if (response.ok) return response.data as T;
  throw new Error(response.error?.message || 'unknown error');
}

function hasRuntimeSendMessage(): boolean {
  const anyGlobal = globalThis as any;
  const browserSend = anyGlobal.browser?.runtime?.sendMessage;
  if (typeof browserSend === 'function') return true;
  const chromeSend = anyGlobal.chrome?.runtime?.sendMessage;
  return typeof chromeSend === 'function';
}

export function usePopupOpenCurrentTabInpageCommentsSidebar() {
  const runtimeAvailable = useMemo(() => hasRuntimeSendMessage(), []);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [checking, setChecking] = useState(() => runtimeAvailable);
  const [opening, setOpening] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [disabledReason, setDisabledReason] = useState<string>(() =>
    runtimeAvailable ? t('checkingDots') : t('commentsSidebarUnavailableHint'),
  );

  const refreshEligibility = useCallback(async () => {
    if (!runtimeAvailable) return;
    if (mountedRef.current) setChecking(true);
    try {
      const response = await send<ApiResponse<CaptureState>>(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE, {});
      const state = unwrap(response);

      if (!state.available) {
        if (!mountedRef.current) return;
        setEligible(false);
        setDisabledReason(t('commentsSidebarUnavailableHint'));
        return;
      }

      if (state.kind !== 'article') {
        if (!mountedRef.current) return;
        setEligible(false);
        setDisabledReason(t('commentsSidebarArticleOnlyHint'));
        return;
      }

      if (!mountedRef.current) return;
      setEligible(true);
      setDisabledReason(t('openInpageCommentsSidebar'));
    } catch (error) {
      const message = (error as any)?.message ?? String(error ?? '');
      if (!mountedRef.current) return;
      setEligible(false);
      setDisabledReason(message || t('commentsSidebarUnavailableHint'));
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, [runtimeAvailable]);

  useEffect(() => {
    if (!runtimeAvailable) return;
    void refreshEligibility();
  }, [refreshEligibility, runtimeAvailable]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!runtimeAvailable) return;
    const onFocus = () => {
      void refreshEligibility();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshEligibility, runtimeAvailable]);

  const open = useCallback(async () => {
    if (!runtimeAvailable) return false;
    if (checking || opening || !eligible) return false;
    if (mountedRef.current) setOpening(true);
    try {
      const response = await send<ApiResponse<{ opened?: boolean }>>(
        UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL,
        {
          source: 'popup',
        },
      );
      const result = unwrap(response);
      return Boolean((result as any)?.opened ?? true);
    } catch (_error) {
      return false;
    } finally {
      if (mountedRef.current) setOpening(false);
    }
  }, [checking, eligible, opening, runtimeAvailable]);

  const disabled = checking || opening || !eligible;
  const ariaLabel = t('openInpageCommentsSidebar');
  const tooltip = useMemo(() => {
    if (opening) return t('fetchingDots');
    if (checking) return t('checkingDots');
    if (eligible) return t('openInpageCommentsSidebarTooltip');
    return disabledReason || t('commentsSidebarUnavailableHint');
  }, [checking, disabledReason, eligible, opening]);

  return { disabled, tooltip, open, ariaLabel };
}

export const usePopupOpenAppCommentsConversation = usePopupOpenCurrentTabInpageCommentsSidebar;
