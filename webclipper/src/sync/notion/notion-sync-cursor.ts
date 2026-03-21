export type NotionSyncCursor = {
  lastSyncedMessageKey: string;
  lastSyncedSequence: number | null;
  lastSyncedAt?: number;
  lastSyncedMessageUpdatedAt?: number | null;
};

export function extractCursor(
  mapping: unknown,
  sectionId?: string | null,
): Pick<NotionSyncCursor, 'lastSyncedMessageKey' | 'lastSyncedSequence' | 'lastSyncedMessageUpdatedAt'> {
  const m = mapping && typeof mapping === 'object' ? (mapping as any) : {};
  const sectionKey = sectionId && String(sectionId).trim() ? String(sectionId).trim() : '';
  const section =
    sectionKey &&
    m.notionSectionCursors &&
    typeof m.notionSectionCursors === 'object' &&
    (m.notionSectionCursors as any)[sectionKey] &&
    typeof (m.notionSectionCursors as any)[sectionKey] === 'object'
      ? (m.notionSectionCursors as any)[sectionKey]
      : null;
  const base = section || m;
  const lastSyncedMessageKey =
    base.lastSyncedMessageKey && String(base.lastSyncedMessageKey).trim()
      ? String(base.lastSyncedMessageKey).trim()
      : '';
  const lastSyncedSequence = Number(base.lastSyncedSequence);
  const lastSyncedMessageUpdatedAt = Number(base.lastSyncedMessageUpdatedAt);
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

  const findIndexBySeq = (needle: number) =>
    list.findIndex((m) => m && Number((m as any).sequence) === needle);

  const maxSequence = () => {
    let max = -Infinity;
    for (const m of list) {
      if (!m) continue;
      const s = Number((m as any).sequence);
      if (Number.isFinite(s)) max = Math.max(max, s);
    }
    return Number.isFinite(max) ? max : null;
  };

  if (key) {
    const idx = list.findIndex((m) => m && String((m as any).messageKey || '') === key);
    if (idx < 0) {
      // messageKey might drift after refresh; fall back to sequence when available.
      if (seq != null) {
        const seqIdx = findIndexBySeq(seq);
        if (seqIdx >= 0) return { ok: true, mode: 'append', newMessages: list.slice(seqIdx + 1), rebuild: false };

        const maxSeq = maxSequence();
        if (maxSeq != null && maxSeq < seq) {
          return { ok: false, mode: 'cursor_incomplete', newMessages: [], rebuild: false };
        }
        return { ok: false, mode: 'cursor_mismatch', newMessages: [], rebuild: false };
      }
      return { ok: false, mode: 'cursor_missing', newMessages: [], rebuild: true };
    }
    return { ok: true, mode: 'append', newMessages: list.slice(idx + 1), rebuild: false };
  }

  if (seq != null) {
    const maxSeq = maxSequence();
    if (maxSeq != null && maxSeq < seq) {
      return { ok: false, mode: 'cursor_incomplete', newMessages: [], rebuild: false };
    }
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
