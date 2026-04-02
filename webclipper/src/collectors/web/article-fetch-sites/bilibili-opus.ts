import type { ArticleFetchSiteSpec } from '@collectors/web/article-fetch-sites/site-spec';

export const BILIBILI_OPUS_SITE_SPEC: ArticleFetchSiteSpec = {
  id: 'bilibili_opus',
  rootSelector: '.bili-opus-view',
  titleSelector: '.opus-module-title__text',
  titleFallbackOrder: ['document', 'meta'],
  authorSelector: '.opus-module-author__name',
  publishedAtSelector: '.opus-module-author__pub__text',
  textSelector: '.opus-module-content',
  textPrefer: 'innerText',
  imageSelector: '.opus-module-top__album img, .horizontal-scroll-album__pic img',
  imageSrcAttributes: ['data-src', 'src'],
  imageSanitizer: 'stripAtSuffix',
};
