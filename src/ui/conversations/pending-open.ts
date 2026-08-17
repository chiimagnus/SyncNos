const PENDING_OPEN_CONVERSATION_KEY = 'webclipper_pending_open_conversation_v2';

export type PendingOpenConversation = Readonly<{ source: string; conversationKey: string }>;

function normalizePendingOpenTarget(target: unknown): { source: string; conversationKey: string } | null {
  const source = String((target as any)?.source || '')
    .trim()
    .toLowerCase();
  const conversationKey = String((target as any)?.conversationKey || '').trim();
  if (!source || !conversationKey) return null;
  return { source, conversationKey };
}

/** Pending-open navigation is stable-identity only. */
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

    if (!raw.startsWith('{')) return null;
    return normalizePendingOpenTarget(JSON.parse(raw));
  } catch (_error) {
    return null;
  }
}
