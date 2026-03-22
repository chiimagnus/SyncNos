export type Conversation = {
  id: number;
  sourceType?: string;
  source: string;
  conversationKey: string;
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
  contentText?: string;
  contentMarkdown?: string;
  sequence?: number;
  updatedAt?: number;
};

export type ConversationDetail = {
  conversationId: number;
  messages: ConversationMessage[];
};
