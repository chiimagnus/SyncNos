import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { UI_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { send } from '@services/shared/runtime';
import { t } from '@i18n';
import type { CurrentPageCaptureState } from '@services/bootstrap/current-page-capture';

type ApiResponse<T> = {
  ok: boolean;
  data: T | null;
  error: { message: string; extra: unknown } | null;
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

export function usePopupOpenCurrentTabInpageCommentsSidebar(input: {
  currentPageState: CurrentPageCaptureState | null;
  checkingCurrentPageState: boolean;
}) {
  const runtimeAvailable = useMemo(() => hasRuntimeSendMessage(), []);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [opening, setOpening] = useState(false);
  const checking = runtimeAvailable && input.checkingCurrentPageState;
  const eligible =
    runtimeAvailable && input.currentPageState?.readiness === 'ready' && input.currentPageState.kind === 'article';
  const disabledReason = useMemo(() => {
    if (!runtimeAvailable) return t('commentsSidebarUnavailableHint');
    if (checking) return t('checkingDots');
    if (input.currentPageState?.readiness !== 'ready') return t('commentsSidebarUnavailableHint');
    if (input.currentPageState.kind !== 'article') return t('commentsSidebarArticleOnlyHint');
    return t('openInpageCommentsSidebar');
  }, [checking, input.currentPageState, runtimeAvailable]);

  const open = useCallback(async () => {
    if (!runtimeAvailable) return false;
    if (checking || opening || !eligible) return false;
    if (mountedRef.current) setOpening(true);
    try {
      const response = await send<ApiResponse<{ opened: boolean }>>(
        UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL,
        {
          source: 'popup',
        },
      );
      const result = unwrap(response);
      return result.opened === true;
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
