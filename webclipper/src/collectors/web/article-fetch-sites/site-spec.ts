export type ArticleFetchTextPrefer = 'innerText' | 'textContent';
export type ArticleFetchImageSanitizer = 'none' | 'stripAtSuffix' | 'stripBangSuffix';

export type ArticleFetchSiteSpec = {
  id: string;
  rootSelector: string;

  titleSelector?: string;
  titleFallbackOrder?: Array<'meta' | 'document'>;
  authorSelector?: string;
  publishedAtSelector?: string;
  textSelector?: string;
  textPrefer?: ArticleFetchTextPrefer;

  imageSelector?: string;
  imageStyleSelectors?: string[];
  imageSrcAttributes?: string[];
  imageSanitizer?: ArticleFetchImageSanitizer;
  imageUrlAllowList?: string[];
  imageUrlBlockList?: string[];
};
