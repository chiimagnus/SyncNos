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

