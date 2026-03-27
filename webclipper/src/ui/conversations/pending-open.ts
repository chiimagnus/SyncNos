const PENDING_OPEN_CONVERSATION_ID_KEY = 'webclipper_pending_open_conversation_id';

export type PendingOpenConversation = {
  conversationId: number;
  source?: string;
  conversationKey?: string;
};

function normalizePendingConversationId(value: unknown): number | null {
  const safeId = Number(value);
  if (!Number.isFinite(safeId) || safeId <= 0) return null;
  return Math.floor(safeId);
}

function normalizePendingOpenTarget(target: unknown): { source: string; conversationKey: string } | null {
  const source = String((target as any)?.source || '')
    .trim()
    .toLowerCase();
  const conversationKey = String((target as any)?.conversationKey || '').trim();
  if (!source || !conversationKey) return null;
  return { source, conversationKey };
}

export function setPendingOpenConversationId(
  conversationId: number,
  target?: { source?: string; conversationKey?: string } | null,
): void {
  const normalizedId = normalizePendingConversationId(conversationId);
  if (normalizedId == null) return;
  const normalizedTarget = normalizePendingOpenTarget(target);
  try {
    if (!normalizedTarget) {
      sessionStorage.setItem(PENDING_OPEN_CONVERSATION_ID_KEY, String(normalizedId));
      return;
    }

    sessionStorage.setItem(
      PENDING_OPEN_CONVERSATION_ID_KEY,
      JSON.stringify({
        conversationId: normalizedId,
        source: normalizedTarget.source,
        conversationKey: normalizedTarget.conversationKey,
      }),
    );
  } catch (_error) {
    // ignore
  }
}

export function consumePendingOpenConversation(): PendingOpenConversation | null {
  try {
    const raw = String(sessionStorage.getItem(PENDING_OPEN_CONVERSATION_ID_KEY) || '').trim();
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_OPEN_CONVERSATION_ID_KEY);

    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw);
      const conversationId = normalizePendingConversationId((parsed as any)?.conversationId);
      if (conversationId == null) return null;
      const target = normalizePendingOpenTarget(parsed);
      if (!target) return { conversationId };
      return {
        conversationId,
        source: target.source,
        conversationKey: target.conversationKey,
      };
    }

    const conversationId = normalizePendingConversationId(raw);
    if (conversationId == null) return null;
    return { conversationId };
  } catch (_error) {
    return null;
  }
}

export function consumePendingOpenConversationId(): number | null {
  const pending = consumePendingOpenConversation();
  if (!pending) return null;
  return pending.conversationId;
}
