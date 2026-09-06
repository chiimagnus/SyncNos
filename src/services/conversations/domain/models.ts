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
  notionPageUrl?: string;
  notionWorkspaceSlug?: string;
  feishuDocId?: string;
  lastCapturedAt?: number;
  commentThreadCount?: number;
};

export type ConversationMessage = {
  id: number;
  conversationId: number;
  messageKey: string;
  role: string;
  authorName?: string;
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
