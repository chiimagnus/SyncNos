export type MentionQuery = {
  raw: string;
  normalized: string;
  empty: boolean;
};

export type MentionCandidate = ConversationMentionCandidate &
  Readonly<{
    factsEpoch: FactsEpoch;
  }>;

export type MentionSearchResult = {
  query: MentionQuery;
  candidates: MentionCandidate[];
  limit: number;
  scannedCount?: number;
  truncatedByScanLimit?: boolean;
};

export type MentionInsertPayload = Readonly<{
  conversationKey: string;
  factsEpoch: FactsEpoch;
  source: string;
}>;

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
import type { ConversationMentionCandidate } from '@services/conversations/domain/models';
import type { FactsEpoch } from '@services/local-data/contracts';
