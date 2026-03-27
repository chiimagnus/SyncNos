export type Conversation = {
  id: number;
  sourceType?: string;
  source: string;
  conversationKey: string;
  listSourceKey?: string;
  listSiteKey?: string;
  title?: string;
  url?: string;
  author?: string;
  publishedAt?: string;
  warningFlags?: string[];
  notionPageId?: string;
  lastCapturedAt?: number;
};

export type ConversationMessage = {
  id: number;
  conversationId: number;
  messageKey: string;
  role: string;
  authorName?: string;
  contentText?: string;
  contentMarkdown?: string;
  sequence?: number;
  updatedAt?: number;
};

export type ConversationDetail = {
  conversationId: number;
  messages: ConversationMessage[];
};

export type { ConversationListQuery, ConversationListQueryInput } from '@services/conversations/domain/list-query';
export type {
  ConversationListCursor,
  ConversationListFacet,
  ConversationListFacets,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationListSummary,
} from '@services/conversations/domain/list-pagination';
