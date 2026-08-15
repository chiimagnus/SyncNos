import type { FactsEpoch, StreamDescriptor } from '@services/local-data/contracts';

export type Conversation = {
  id: number;
  sourceType?: string;
  source: string;
  conversationKey: string;
  factsEpoch?: FactsEpoch;
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
  contentText?: string;
  contentMarkdown?: string;
  sequence?: number;
  updatedAt?: number;
};

export type ConversationDetail = {
  conversationId: number;
  source?: string;
  conversationKey?: string;
  factsEpoch?: FactsEpoch;
  messages: ConversationMessage[];
};

export type ConversationReadStreamPreflight = Readonly<{
  kind: 'stream';
  requestId: string;
  stream: StreamDescriptor;
}>;

export type ConversationDetailResponse = ConversationDetail &
  Readonly<{
    conversationKey: string;
    factsEpoch: FactsEpoch;
    source: string;
  }>;

export type ConversationDetailReadResponse = ConversationDetailResponse | ConversationReadStreamPreflight;

export type ConversationFactsReference = Readonly<{
  source: string;
  conversationKey: string;
  factsEpoch: FactsEpoch;
  conversationId?: number;
}>;

export type ConversationMentionCandidate = Readonly<{
  conversationId: number;
  source: string;
  conversationKey: string;
  title: string;
  url: string;
  domain: string;
  sourceType: string;
  lastCapturedAt: number;
}>;

export type ConversationTailWindow = Readonly<{
  conversationId: number | null;
  messages: ConversationMessage[];
}>;

export type ConversationTailWindowResponse = ConversationTailWindow &
  Readonly<{
    conversationKey: string;
    factsEpoch: FactsEpoch;
    source: string;
  }>;

export type ConversationTailWindowReadResponse = ConversationTailWindowResponse | ConversationReadStreamPreflight;

export type { ConversationListQuery, ConversationListQueryInput } from '@services/conversations/domain/list-query';
export type {
  ConversationListCursor,
  ConversationListFacet,
  ConversationListFacets,
  ConversationListOpenTarget,
  ConversationListPage,
  ConversationListSummary,
} from '@services/conversations/domain/list-pagination';
