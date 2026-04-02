import type { ArticleFetchSiteSpec } from '@collectors/web/article-fetch-sites/site-spec';

export const XHS_NOTE_SITE_SPEC: ArticleFetchSiteSpec = {
  id: 'xhs_note',
  rootSelector: '#noteContainer.note-container, #noteContainer',
  titleFallbackOrder: ['meta', 'document'],
  authorSelector: '.author .username',
  publishedAtSelector: '.note-content .bottom-container .date, .note-content .date',
  textSelector: '#detail-desc, .note-content #detail-desc, .note-content .desc',
  textPrefer: 'innerText',
  imageSelector: '.media-container img',
  imageStyleSelectors: ['.media-container .swiper-slide[style*="background"]'],
  imageSrcAttributes: ['data-src', 'src'],
  imageSanitizer: 'stripBangSuffix',
  // XHS avatar CDN is typically hotlink-protected; exclude it to avoid broken images in extension UI.
  imageUrlAllowList: ['sns-webpic'],
  imageUrlBlockList: ['sns-avatar', '/avatar/'],
};
