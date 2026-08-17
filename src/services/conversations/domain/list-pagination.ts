import type { Conversation } from '@services/conversations/domain/models';
import type { FactsEpoch } from '@services/local-data/contracts';

export type ConversationListCursor =
  | {
      lastCapturedAt: number;
      id: number;
    }
  | {
      nativeCursor: string;
    };

export type ConversationListSummary = {
  totalCount: number;
  todayCount: number;
};

export type ConversationListFacet = {
  key: string;
  label: string;
  count: number;
};

export type ConversationListFacets = {
  sources: ConversationListFacet[];
  sites: ConversationListFacet[];
};

export type ConversationListOpenTarget = {
  id: number;
  source: string;
  conversationKey: string;
  factsEpoch?: FactsEpoch;
  title?: string;
  url?: string;
  sourceType?: string;
  lastCapturedAt: number;
};

export type ConversationListPage<TItem = Conversation> = {
  factsEpoch?: FactsEpoch;
  /** SQLite-only monotonic revision captured from the same list snapshot; IDB is null. */
  factsRevision?: number | null;
  items: TItem[];
  cursor: ConversationListCursor | null;
  hasMore: boolean;
  summary: ConversationListSummary;
  facets: ConversationListFacets;
};
