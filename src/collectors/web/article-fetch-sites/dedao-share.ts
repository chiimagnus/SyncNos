import type { ArticleFetchSiteSpec } from '@collectors/web/article-fetch-sites/site-spec';

export const DEDAO_SHARE_SITE_SPEC: ArticleFetchSiteSpec = {
  id: 'dedao_share',
  urlPattern: /^https?:\/\/(?:www\.)?dedao\.cn\//i,
  rootSelector: '.main-content',
  titleSelector: '.article-title',
  textSelector: '.article-body',
  textPrefer: 'innerText',
  useSanitizedRootHtml: true,
  removeSelectors: [
    '.invoke-bar-box',
    '.article-header-wrapper',
    '#playerBox',
    '.list-top',
    '.dd-message-list-container',
    '.to-app-box',
    '.dd-popup',
  ],
};
