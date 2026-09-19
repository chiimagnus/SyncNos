import { lazy } from 'react';

export const LazyConversationDetailPane = lazy(() =>
  import('./ConversationDetailPane').then((module) => ({ default: module.ConversationDetailPane })),
);

export const LazyArticleCommentsSection = lazy(() =>
  import('./ArticleCommentsSection').then((module) => ({ default: module.ArticleCommentsSection })),
);
