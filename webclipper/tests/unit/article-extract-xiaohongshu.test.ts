// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { extractBySiteSpec } from '@collectors/web/article-extract/site-spec-extractor';
import { XIAOHONGSHU_NOTE_SITE_SPEC } from '@collectors/web/article-fetch-sites/xiaohongshu-note';

describe('article-extract xiaohongshu', () => {
  it('extracts note text and images from hydrated DOM', () => {
    document.body.innerHTML = `
      <div id="noteContainer" class="note-container">
        <div class="author-wrapper">
          <a class="name"><span class="username">作者</span></a>
        </div>
        <div class="media-container">
          <img src="https://sns-webpic-qc.xhscdn.com/202604061902/aaa/spectrum/1040g!nd_dft_wlteh_webp_3" />
          <img src="https://sns-webpic-qc.xhscdn.com/202604061902/bbb/spectrum/1040g!nd_dft_wlteh_webp_3" />
        </div>
        <div class="content">
          <span class="note-text">这里是正文</span>
        </div>
      </div>
    `;

    const res = extractBySiteSpec(XIAOHONGSHU_NOTE_SITE_SPEC, 'https://www.xiaohongshu.com/explore/123');
    expect(res).toBeTruthy();
    expect(res?.author).toBe('作者');
    expect(String(res?.contentMarkdown || '')).toContain('这里是正文');
    expect(String(res?.contentMarkdown || '')).toContain('sns-webpic-qc.xhscdn.com');
  });
});
