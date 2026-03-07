export type NotionSyncCursor = {
  lastSyncedMessageKey: string;
  lastSyncedSequence: number | null;
  lastSyncedAt?: number;
  lastSyncedMessageUpdatedAt?: number | null;
};

export function extractCursor(
  mapping: unknown,
): Pick<NotionSyncCursor, 'lastSyncedMessageKey' | 'lastSyncedSequence' | 'lastSyncedMessageUpdatedAt'> {
  const m = mapping && typeof mapping === 'object' ? (mapping as any) : {};
  const lastSyncedMessageKey =
    m.lastSyncedMessageKey && String(m.lastSyncedMessageKey).trim()
      ? String(m.lastSyncedMessageKey).trim()
      : '';
  const lastSyncedSequence = Number(m.lastSyncedSequence);
  const lastSyncedMessageUpdatedAt = Number(m.lastSyncedMessageUpdatedAt);
  const seq = Number.isFinite(lastSyncedSequence) ? lastSyncedSequence : null;
  return {
    lastSyncedMessageKey,
    lastSyncedSequence: seq,
    lastSyncedMessageUpdatedAt: Number.isFinite(lastSyncedMessageUpdatedAt) ? lastSyncedMessageUpdatedAt : null,
  };
}

export function computeNewMessages(messages: unknown, cursor: Partial<NotionSyncCursor> | null | undefined): {
  ok: boolean;
  mode: string;
  newMessages: any[];
  rebuild: boolean;
} {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return { ok: true, mode: 'empty', newMessages: [], rebuild: false };

  const key = cursor?.lastSyncedMessageKey ? String(cursor.lastSyncedMessageKey) : '';
  const rawSeq = cursor ? (cursor as any).lastSyncedSequence : null;
  const seq =
    rawSeq == null
      ? null
      : Number.isFinite(Number(rawSeq))
        ? Number(rawSeq)
        : null;

  if (key) {
    const idx = list.findIndex((m) => m && String((m as any).messageKey || '') === key);
    if (idx < 0) return { ok: false, mode: 'cursor_missing', newMessages: [], rebuild: true };
    return { ok: true, mode: 'append', newMessages: list.slice(idx + 1), rebuild: false };
  }

  if (seq != null) {
    const next = list.filter((m) => m && Number((m as any).sequence) > seq);
    return { ok: true, mode: 'append', newMessages: next, rebuild: false };
  }

  return { ok: false, mode: 'cursor_missing', newMessages: [], rebuild: true };
}

export function lastMessageCursor(messages: unknown): NotionSyncCursor {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) {
    return {
      lastSyncedMessageKey: '',
      lastSyncedSequence: null,
      lastSyncedAt: Date.now(),
      lastSyncedMessageUpdatedAt: null,
    };
  }

  const last = list[list.length - 1] as any;
  const key = last && last.messageKey ? String(last.messageKey) : '';
  const seq = Number(last && last.sequence);
  const updatedAt = Number(last && last.updatedAt);
  return {
    lastSyncedMessageKey: key,
    lastSyncedSequence: Number.isFinite(seq) ? seq : null,
    lastSyncedAt: Date.now(),
    lastSyncedMessageUpdatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
  };
}
