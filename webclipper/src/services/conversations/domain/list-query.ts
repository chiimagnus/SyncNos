export const LIST_SOURCE_KEY_ALL = 'all';
export const LIST_SITE_KEY_ALL = 'all';
export const DEFAULT_LIST_PAGE_LIMIT = 50;

export type ConversationListQuery = {
  sourceKey: string;
  siteKey: string;
  limit: number;
};

export type ConversationListQueryInput = Partial<ConversationListQuery>;

function normalizeFilterKey(value: unknown, fallback: string): string {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  return text || fallback;
}

function normalizeLimit(value: unknown): number {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIST_PAGE_LIMIT;
  return Math.min(Math.floor(limit), 200);
}

export function normalizeConversationListQuery(input?: ConversationListQueryInput | null): ConversationListQuery {
  return {
    sourceKey: normalizeFilterKey(input?.sourceKey, LIST_SOURCE_KEY_ALL),
    siteKey: normalizeFilterKey(input?.siteKey, LIST_SITE_KEY_ALL),
    limit: normalizeLimit(input?.limit),
  };
}
