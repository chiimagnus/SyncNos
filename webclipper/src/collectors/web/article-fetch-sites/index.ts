import type { ArticleFetchSiteSpec } from '@collectors/web/article-fetch-sites/site-spec';
import { BILIBILI_OPUS_SITE_SPEC } from '@collectors/web/article-fetch-sites/bilibili-opus';
import { XIAOHONGSHU_NOTE_SITE_SPEC } from '@collectors/web/article-fetch-sites/xiaohongshu-note';

export const ARTICLE_FETCH_SITE_SPECS: ArticleFetchSiteSpec[] = [XIAOHONGSHU_NOTE_SITE_SPEC, BILIBILI_OPUS_SITE_SPEC];
