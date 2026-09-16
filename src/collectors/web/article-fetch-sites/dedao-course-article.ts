import type { ArticleFetchSiteSpec } from '@collectors/web/article-fetch-sites/site-spec';

export const DEDAO_COURSE_ARTICLE_SITE_SPEC: ArticleFetchSiteSpec = {
  id: 'dedao_course_article',
  urlPattern: /^https?:\/\/(?:www\.)?dedao\.cn\/course\/article\b/i,
  rootSelector: '.editor-show',
  titleFallbackOrder: ['document', 'meta'],
  textPrefer: 'innerText',
  useSanitizedRootHtml: true,
  removeSelectors: [':scope > :not([data-module-type])', '.quoted .author img'],
};
