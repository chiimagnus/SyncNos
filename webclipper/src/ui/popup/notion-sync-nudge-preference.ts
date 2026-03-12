import { storageGet, storageSet } from '../../platform/storage/local';

const POPUP_NOTION_SYNC_NUDGE_DISMISSED_KEY = 'webclipper_popup_notion_sync_open_tab_dont_show_v1';

export async function getPopupNotionSyncNudgeDismissed(): Promise<boolean> {
  const res = await storageGet([POPUP_NOTION_SYNC_NUDGE_DISMISSED_KEY]).catch(() => ({}));
  return Boolean((res as any)?.[POPUP_NOTION_SYNC_NUDGE_DISMISSED_KEY]);
}

export async function setPopupNotionSyncNudgeDismissed(next: boolean): Promise<void> {
  await storageSet({ [POPUP_NOTION_SYNC_NUDGE_DISMISSED_KEY]: Boolean(next) });
}

