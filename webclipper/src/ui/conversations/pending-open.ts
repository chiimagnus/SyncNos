const PENDING_OPEN_CONVERSATION_ID_KEY = 'webclipper_pending_open_conversation_id';

export function setPendingOpenConversationId(conversationId: number): void {
  const safeId = Number(conversationId);
  if (!Number.isFinite(safeId) || safeId <= 0) return;
  try {
    sessionStorage.setItem(PENDING_OPEN_CONVERSATION_ID_KEY, String(Math.floor(safeId)));
  } catch (_error) {
    // ignore
  }
}

export function consumePendingOpenConversationId(): number | null {
  try {
    const raw = String(sessionStorage.getItem(PENDING_OPEN_CONVERSATION_ID_KEY) || '').trim();
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_OPEN_CONVERSATION_ID_KEY);
    const safeId = Number(raw);
    if (!Number.isFinite(safeId) || safeId <= 0) return null;
    return Math.floor(safeId);
  } catch (_error) {
    return null;
  }
}

