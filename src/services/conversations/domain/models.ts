import type { VideoChapter, VideoPlatform } from '@services/shared/video-capture';
import type { VideoTranscriptCue } from '@services/conversations/domain/video-content';

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
  lastActivityAt: number;
  commentThreadCount?: number;
  platform?: VideoPlatform;
  durationSeconds?: number | null;
  thumbnailUrl?: string;
  videoDescription?: string;
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
  transcriptCues?: VideoTranscriptCue[];
  videoChapters?: VideoChapter[];
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
