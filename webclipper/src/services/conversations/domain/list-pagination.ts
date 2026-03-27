import type { Conversation } from '@services/conversations/domain/models';

export type ConversationListCursor = {
  lastCapturedAt: number;
  id: number;
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
  title?: string;
  url?: string;
  sourceType?: string;
  lastCapturedAt: number;
};

export type ConversationListPage<TItem = Conversation> = {
  items: TItem[];
  cursor: ConversationListCursor | null;
  hasMore: boolean;
  summary: ConversationListSummary;
  facets: ConversationListFacets;
};
