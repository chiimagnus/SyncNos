export type MentionQuery = {
  raw: string;
  normalized: string;
  empty: boolean;
};

export type MentionCandidate = {
  conversationId: number;
  title: string;
  source: string;
  url: string;
  domain: string;
  sourceType: string;
  lastCapturedAt: number;
};

export type MentionSearchResult = {
  query: MentionQuery;
  candidates: MentionCandidate[];
  limit: number;
  scannedCount?: number;
  truncatedByScanLimit?: boolean;
};

export type MentionInsertPayload = {
  conversationId: number;
};

export function normalizeMentionQuery(raw: unknown): MentionQuery {
  const text = String(raw || '');
  const normalized = text.trim().toLowerCase();
  return { raw: text, normalized, empty: !normalized };
}

export function normalizeMentionSearchLimit(raw: unknown, defaults?: { defaultLimit?: number; maxLimit?: number }) {
  const defaultLimit = Math.max(1, Math.floor(Number(defaults?.defaultLimit ?? 20)));
  const maxLimit = Math.max(defaultLimit, Math.floor(Number(defaults?.maxLimit ?? 50)));
  if (raw == null || raw === '') return defaultLimit;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultLimit;
  return Math.min(Math.floor(n), maxLimit);
}
