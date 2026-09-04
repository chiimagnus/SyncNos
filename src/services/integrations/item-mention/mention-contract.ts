export type MentionQuery = {
  normalized: string;
  empty: boolean;
};

export type MentionCandidate = {
  conversationId: number;
  title: string;
  source: string;
  domain: string;
  lastCapturedAt: number;
};

export type MentionSearchResult = {
  candidates: MentionCandidate[];
};

export type MentionInsertPayload = {
  conversationId: number;
};

export function normalizeMentionQuery(raw: unknown): MentionQuery {
  const normalized = String(raw || '').trim().toLowerCase();
  return { normalized, empty: !normalized };
}

export function normalizeMentionSearchLimit(raw: unknown) {
  if (raw == null || raw === '') return 20;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(Math.floor(n), 50);
}
