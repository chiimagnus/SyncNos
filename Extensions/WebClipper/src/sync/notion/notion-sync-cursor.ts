export type NotionSyncCursor = {
  lastSyncedMessageKey: string;
  lastSyncedSequence: number | null;
  lastSyncedAt?: number;
};

export function extractCursor(mapping: unknown): Pick<NotionSyncCursor, 'lastSyncedMessageKey' | 'lastSyncedSequence'> {
  const m = mapping && typeof mapping === 'object' ? (mapping as any) : {};
  const lastSyncedMessageKey =
    m.lastSyncedMessageKey && String(m.lastSyncedMessageKey).trim()
      ? String(m.lastSyncedMessageKey).trim()
      : '';
  const lastSyncedSequence = Number(m.lastSyncedSequence);
  const seq = Number.isFinite(lastSyncedSequence) ? lastSyncedSequence : null;
  return { lastSyncedMessageKey, lastSyncedSequence: seq };
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
  const seq =
    cursor && Number.isFinite(Number(cursor.lastSyncedSequence))
      ? Number(cursor.lastSyncedSequence)
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
  if (!list.length) return { lastSyncedMessageKey: '', lastSyncedSequence: null, lastSyncedAt: Date.now() };

  const last = list[list.length - 1] as any;
  const key = last && last.messageKey ? String(last.messageKey) : '';
  const seq = Number(last && last.sequence);
  return {
    lastSyncedMessageKey: key,
    lastSyncedSequence: Number.isFinite(seq) ? seq : null,
    lastSyncedAt: Date.now(),
  };
}

