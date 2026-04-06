import type { ArticleFetchSiteSpec } from '@collectors/web/article-fetch-sites/site-spec';

export const XIAOHONGSHU_NOTE_SITE_SPEC: ArticleFetchSiteSpec = {
  id: 'xiaohongshu_note',
  rootSelector: '#noteContainer',
  titleFallbackOrder: ['document', 'meta'],
  authorSelector: '.author-wrapper .name .username, .author-wrapper .name',
  publishedAtSelector: '.info .date span, .info .date',
  textSelector: '.content .note-text, .note-text, .content',
  textPrefer: 'innerText',
  imageSelector: '.media-container img, .note-slider-img img, .img-container img',
  imageSrcAttributes: ['data-src', 'data-original', 'src'],
  imageSanitizer: 'none',
};
