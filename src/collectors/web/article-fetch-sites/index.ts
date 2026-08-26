import type { ArticleFetchSiteSpec } from '@collectors/web/article-fetch-sites/site-spec';
import { BILIBILI_OPUS_SITE_SPEC } from '@collectors/web/article-fetch-sites/bilibili-opus';
import { DEDAO_NOTE_DETAIL_SITE_SPEC } from '@collectors/web/article-fetch-sites/dedao-note-detail';
import { DEDAO_SHARE_SITE_SPEC } from '@collectors/web/article-fetch-sites/dedao-share';
import { XIAOHONGSHU_NOTE_SITE_SPEC } from '@collectors/web/article-fetch-sites/xiaohongshu-note';

export const ARTICLE_FETCH_SITE_SPECS: ArticleFetchSiteSpec[] = [
  DEDAO_NOTE_DETAIL_SITE_SPEC,
  DEDAO_SHARE_SITE_SPEC,
  XIAOHONGSHU_NOTE_SITE_SPEC,
  BILIBILI_OPUS_SITE_SPEC,
];
