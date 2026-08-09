import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import Defuddle from 'defuddle';

import { extractBySiteSpec } from '@collectors/web/article-extract/site-spec-extractor';
import { extractDiscourseOpOnly } from '@collectors/web/article-extract/sites/discourse';
import { BILIBILI_OPUS_SITE_SPEC } from '@collectors/web/article-fetch-sites/bilibili-opus';
import { XIAOHONGSHU_NOTE_SITE_SPEC } from '@collectors/web/article-fetch-sites/xiaohongshu-note';

function setDomGlobals(dom: JSDOM) {
  const globals = globalThis as any;
  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.location = dom.window.location;
}

function clearDomGlobals() {
  const globals = globalThis as any;
  delete globals.window;
  delete globals.document;
  delete globals.location;
}

function defuddleContent(dom: JSDOM, url: string) {
  return String(
    new Defuddle(dom.window.document, {
      url,
      markdown: false,
      separateMarkdown: false,
      useAsync: false,
      includeReplies: 'extractors',
    }).parse().content || '',
  );
}

afterEach(clearDomGlobals);

describe('Defuddle article overlap boundaries', () => {
  it('keeps the Bilibili Opus path for CDN URL normalization and metadata', () => {
    const url = 'https://www.bilibili.com/opus/123';
    const dom = new JSDOM(
      `<!doctype html><title>页面标题</title><body>
        <div class="bili-opus-view">
          <div class="opus-module-top__album"><div class="horizontal-scroll-album__pic__img"><img src="//i0.hdslb.com/bfs/a.jpg@858w.webp" /></div></div>
          <div class="opus-module-title"><span class="opus-module-title__text">动态标题</span></div>
          <div class="opus-module-author"><div class="opus-module-author__name">作者</div></div>
          <div class="opus-module-content"><p>动态正文</p></div>
        </div>
      </body>`,
      { url },
    );
    setDomGlobals(dom);

    expect(defuddleContent(dom, url)).toContain('a.jpg@858w.webp');
    expect(extractBySiteSpec(BILIBILI_OPUS_SITE_SPEC, url)).toMatchObject({
      title: '动态标题',
      author: '作者',
      contentHTML: expect.stringContaining('a.jpg'),
    });
    expect(String(extractBySiteSpec(BILIBILI_OPUS_SITE_SPEC, url)?.contentHTML)).not.toContain('@858w.webp');
  });

  it('keeps Xiaohongshu comments opt-in instead of treating all rendered comments as article content', () => {
    const url = 'https://www.xiaohongshu.com/explore/123';
    const dom = new JSDOM(
      `<!doctype html><body>
        <div id="noteContainer">
          <div class="content"><span class="note-text">笔记正文</span></div>
          <div class="comments-el"><p>评论内容</p></div>
        </div>
      </body>`,
      { url },
    );
    setDomGlobals(dom);

    expect(defuddleContent(dom, url)).toContain('评论内容');
    expect(extractBySiteSpec(XIAOHONGSHU_NOTE_SITE_SPEC, url)?.textContent).toBe('笔记正文');
  });

  it('keeps Discourse OP-only article capture instead of storing the complete discussion', () => {
    const url = 'https://forum.example/t/topic/1';
    const dom = new JSDOM(
      `<!doctype html><title>主题</title><meta name="generator" content="Discourse 3"><body>
        <article class="topic-post" data-post-number="1"><div class="cooked"><p>楼主正文</p></div></article>
        <article class="topic-post" data-post-number="2"><div class="cooked"><p>回复正文</p></div></article>
      </body>`,
      { url },
    );
    setDomGlobals(dom);

    expect(defuddleContent(dom, url)).toContain('回复正文');
    expect(extractDiscourseOpOnly(url, /^\/t\/([^/]+)\/(\d+)(?:\/(\d+))?$/)?.textContent).toBe('楼主正文');
  });
});
