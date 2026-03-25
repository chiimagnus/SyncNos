import type { CommentSidebarItem } from '@services/comments/sidebar/comment-sidebar-contract';
import type { ArticleCommentLocator } from '@services/comments/domain/models';

export type ArticleCommentsSidebarContext = {
  canonicalUrl: string;
  conversationId: number | null;
};

export type ArticleCommentsSidebarEnsureContextInput = {
  tabId?: number | null;
  canonicalUrlFallback?: string;
  ensureArticle?: boolean;
};

export type ArticleCommentsSidebarAdapter = {
  list: (input: { canonicalUrl: string }) => Promise<CommentSidebarItem[]>;
  addRoot: (input: {
    canonicalUrl: string;
    conversationId: number | null;
    quoteText: string;
    commentText: string;
    locator?: ArticleCommentLocator | null;
  }) => Promise<void | true>;
  addReply: (input: {
    canonicalUrl: string;
    conversationId: number | null;
    parentId: number;
    commentText: string;
  }) => Promise<void>;
  delete: (input: { id: number }) => Promise<void>;
  ensureContext?: (input?: ArticleCommentsSidebarEnsureContextInput) => Promise<ArticleCommentsSidebarContext>;
};
