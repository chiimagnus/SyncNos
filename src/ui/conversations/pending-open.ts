const PENDING_OPEN_CONVERSATION_KEY = 'webclipper_pending_open_conversation_id';

export type PendingOpenConversation =
  | Readonly<{ source: string; conversationKey: string }>
  | Readonly<{ legacyIdbConversationId: number }>;

function normalizeLegacyConversationId(value: unknown): number | null {
  const safeId = Number(value);
  if (!Number.isSafeInteger(safeId) || safeId <= 0) return null;
  return safeId;
}

function normalizePendingOpenTarget(target: unknown): { source: string; conversationKey: string } | null {
  const source = String((target as any)?.source || '')
    .trim()
    .toLowerCase();
  const conversationKey = String((target as any)?.conversationKey || '').trim();
  if (!source || !conversationKey) return null;
  return { source, conversationKey };
}

/** New pending-open state is stable-identity only; numeric IDs are read-only legacy IDB-v1 state. */
export function setPendingOpenConversation(target: { source: string; conversationKey: string }): void {
  const normalizedTarget = normalizePendingOpenTarget(target);
  if (!normalizedTarget) return;
  try {
    sessionStorage.setItem(PENDING_OPEN_CONVERSATION_KEY, JSON.stringify(normalizedTarget));
  } catch (_error) {
    // Session state is optional navigation help; route navigation still works without it.
  }
}

export function consumePendingOpenConversation(): PendingOpenConversation | null {
  try {
    const raw = String(sessionStorage.getItem(PENDING_OPEN_CONVERSATION_KEY) || '').trim();
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_OPEN_CONVERSATION_KEY);

    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw);
      const target = normalizePendingOpenTarget(parsed);
      if (target) return target;
      const legacyIdbConversationId = normalizeLegacyConversationId((parsed as any)?.conversationId);
      return legacyIdbConversationId == null ? null : { legacyIdbConversationId };
    }

    const legacyIdbConversationId = normalizeLegacyConversationId(raw);
    return legacyIdbConversationId == null ? null : { legacyIdbConversationId };
  } catch (_error) {
    return null;
  }
}
