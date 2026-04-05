import { useCallback } from 'react';

import { UI_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { send } from '@services/shared/runtime';

type ApiResponse<T> = {
  ok: boolean;
  data: T | null;
  error: { message: string; extra: unknown } | null;
};

export function usePopupOpenInpageCommentsSidebar() {
  return useCallback(async () => {
    try {
      const response = await send<ApiResponse<{ opened: boolean }>>(UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL, {
        selectionText: '',
        source: 'popup',
      });
      return response?.ok === true;
    } catch (_error) {
      return false;
    }
  }, []);
}

