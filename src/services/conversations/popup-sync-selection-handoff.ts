import { storageGet, storageOnChanged, storageSet } from '@services/shared/storage';
import { normalizeSyncConversationIds } from '@services/sync/sync-conversation-ids';

export const POPUP_SYNC_SELECTION_HANDOFF_KEY = 'webclipper_popup_sync_selection_handoff_v1';
const POPUP_SYNC_SELECTION_HANDOFF_TTL_MS = 60_000;

type PopupSyncSelectionHandoff = {
  conversationIds: number[];
  createdAt: number;
};

function parsePopupSyncSelectionHandoff(value: unknown, now: number): PopupSyncSelectionHandoff | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const conversationIds = normalizeSyncConversationIds(row.conversationIds);
  const createdAt = Number(row.createdAt);
  if (!conversationIds.length || !Number.isFinite(createdAt) || createdAt <= 0) return null;
  if (Math.abs(now - createdAt) > POPUP_SYNC_SELECTION_HANDOFF_TTL_MS) return null;
  return { conversationIds, createdAt };
}

export async function publishPopupSyncSelectionHandoff(conversationIds: readonly number[]): Promise<void> {
  const normalized = normalizeSyncConversationIds(conversationIds);
  if (!normalized.length) return;
  await storageSet({
    [POPUP_SYNC_SELECTION_HANDOFF_KEY]: {
      conversationIds: normalized,
      createdAt: Date.now(),
    },
  });
}

export async function readPopupSyncSelectionHandoff(): Promise<number[] | null> {
  const stored = await storageGet([POPUP_SYNC_SELECTION_HANDOFF_KEY]);
  return parsePopupSyncSelectionHandoff(stored[POPUP_SYNC_SELECTION_HANDOFF_KEY], Date.now())?.conversationIds ?? null;
}

export function subscribePopupSyncSelectionHandoff(listener: (conversationIds: number[]) => void): () => void {
  return storageOnChanged((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes?.[POPUP_SYNC_SELECTION_HANDOFF_KEY];
    if (!change) return;
    const parsed = parsePopupSyncSelectionHandoff(change.newValue, Date.now());
    if (parsed) listener(parsed.conversationIds);
  });
}
