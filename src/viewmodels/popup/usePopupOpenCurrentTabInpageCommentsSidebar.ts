import { useCallback, useMemo, useState } from 'react';

import { UI_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { send } from '@services/shared/runtime';
import { t } from '@i18n';
import type { CurrentPageCaptureState } from '@services/bootstrap/current-page-capture';
import type { PopupCaptureStatus } from '@viewmodels/popup/usePopupCurrentPageCapture';

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

export function usePopupOpenCurrentTabInpageCommentsSidebar(input: {
  captureState: CurrentPageCaptureState | null;
  checking: boolean;
  status: PopupCaptureStatus | null;
}) {
  const { captureState, checking, status } = input;
  const [opening, setOpening] = useState(false);
  const eligible = captureState?.readiness === 'ready' && captureState.kind === 'article';

  const open = useCallback(async () => {
    if (checking || opening || !eligible) return false;
    setOpening(true);
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
      setOpening(false);
    }
  }, [checking, eligible, opening]);

  const disabled = checking || opening || !eligible;
  const ariaLabel = t('openInpageCommentsSidebar');
  const tooltip = useMemo(() => {
    if (opening) return t('fetchingDots');
    if (checking) return t('checkingDots');
    if (eligible) return t('openInpageCommentsSidebarTooltip');
    if (!captureState && status?.kind === 'error') return status.message || t('commentsSidebarUnavailableHint');
    if (captureState?.readiness === 'ready') return t('commentsSidebarArticleOnlyHint');
    return t('commentsSidebarUnavailableHint');
  }, [captureState, checking, eligible, opening, status]);

  return { disabled, tooltip, open, ariaLabel };
}
