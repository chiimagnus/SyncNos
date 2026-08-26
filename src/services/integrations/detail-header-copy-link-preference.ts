import type { DetailHeaderAction } from '@services/integrations/detail-header-action-types';
import { storageGet, storageSet } from '@services/shared/storage';

export const DETAIL_HEADER_COPY_LINK_ACTION_STORAGE_KEY = 'webclipper_detail_header_last_copy_link_action_v1';

function normalizeActionId(value: unknown): string {
  return String(value || '').trim();
}

export async function readLastDetailHeaderCopyLinkActionId(): Promise<string> {
  try {
    const values = await storageGet([DETAIL_HEADER_COPY_LINK_ACTION_STORAGE_KEY]);
    return normalizeActionId(values?.[DETAIL_HEADER_COPY_LINK_ACTION_STORAGE_KEY]);
  } catch (_error) {
    return '';
  }
}

export async function rememberDetailHeaderCopyLinkAction(actionId: string): Promise<void> {
  const normalizedActionId = normalizeActionId(actionId);
  if (!normalizedActionId) return;
  try {
    await storageSet({ [DETAIL_HEADER_COPY_LINK_ACTION_STORAGE_KEY]: normalizedActionId });
  } catch (_error) {
    // 记忆失败不应阻断用户已选择的复制操作。
  }
}

export function prioritizeDetailHeaderCopyLinkActions(
  actions: DetailHeaderAction[],
  preferredActionId: string,
): DetailHeaderAction[] {
  const preferredIndex = actions.findIndex((action) => action.id === preferredActionId);
  if (preferredIndex <= 0) return actions;
  return [actions[preferredIndex]!, ...actions.slice(0, preferredIndex), ...actions.slice(preferredIndex + 1)];
}
