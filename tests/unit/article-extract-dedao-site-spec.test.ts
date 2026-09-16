// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { htmlToMarkdownTurndown } from '@collectors/web/article-extract/markdown-turndown';
import { extractBySiteSpec } from '@collectors/web/article-extract/site-spec-extractor';
import { DEDAO_COURSE_ARTICLE_SITE_SPEC } from '@collectors/web/article-fetch-sites/dedao-course-article';
import { DEDAO_NOTE_DETAIL_SITE_SPEC } from '@collectors/web/article-fetch-sites/dedao-note-detail';
import { DEDAO_SHARE_SITE_SPEC } from '@collectors/web/article-fetch-sites/dedao-share';
import { buildDedaoNoteInnerHtml } from '../helpers/dedao-note-fixture';

describe('article-extract dedao site spec', () => {
  it('keeps note body, source card, and comment discussion while removing avatars and noisy UI', () => {
    document.body.innerHTML = `<div id="app">${buildDedaoNoteInnerHtml()}</div>`;
    document.title = '得到APP - 知识就是力量，知识就在得到';

    const res = extractBySiteSpec(
      DEDAO_NOTE_DETAIL_SITE_SPEC,
      'https://www.dedao.cn/knowledge/note/detail?id=AaWVPxLgY8DkXGMkJyEGXnDqwEoXJ9',
    );

    expect(res).toBeTruthy();
    expect(res?.author).toBe('作者示例');
    expect(res?.publishedAt).toBe('03-23');
    expect(String(res?.textContent || '')).toContain('正文段落一：这是用于抽取回归测试的示例内容。');
    expect(String(res?.textContent || '')).toContain('正文段落二：抽取器应该保留这段核心文本。');
    expect(String(res?.textContent || '')).toContain('评论区示例：这条讨论内容应该被保留下来。');
    expect(String(res?.textContent || '')).not.toContain('关注他们，获取更多优质内容');
    expect(String(res?.textContent || '')).not.toContain('添加评论');
    expect(String(res?.textContent || '')).not.toContain('转发 3');
    expect(String(res?.contentHTML || '')).toContain('source-card');
    expect(String(res?.contentHTML || '')).not.toContain('write-comment');
    expect(String(res?.contentHTML || '')).not.toContain('forward-list');
    expect(String(res?.contentHTML || '')).not.toContain('like-list');
    expect(String(res?.contentHTML || '')).not.toContain('uploader/image/avatar');

    const markdown = htmlToMarkdownTurndown(
      String(res?.contentHTML || ''),
      'https://www.dedao.cn/knowledge/note/detail?id=AaWVPxLgY8DkXGMkJyEGXnDqwEoXJ9',
    );
    expect(markdown).toContain('正文段落一：这是用于抽取回归测试的示例内容。');
    expect(markdown).not.toContain('* * *');
    expect(markdown).not.toContain('\n---\n');
  });

  it('keeps reader questions and reply attribution in course Q&A articles', () => {
    document.title = '问答：设计结构矩阵和甘特图的区别是什么？ - 得到APP';
    document.body.innerHTML = `
      <div class="editor-show">
        <div class="dd-audio" data-module-type="custom">
          <div class="dd-audio-player">
            <span class="audio-title">问答：设计结构矩阵和甘特图的区别是什么？</span>
            <span class="audio-duration">11分58秒</span>
          </div>
          <div class="audio-tips">转述：怀沙AI</div>
        </div>
        <p data-module-type="internal"><a data-link="igetapp://class/article?id=1">来自《脆弱和反脆弱》</a></p>
        <div class="tag-module lineable" data-module-type="custom">
          <div class="tag-content"><div class="tag"><span>读者 刘福起：</span></div></div>
          <blockquote><span>请教万老师：每个月五天禁食，只喝水，这个事情是属于反脆弱，激活好细胞吗？</span></blockquote>
        </div>
        <div class="quoted" data-module-type="custom">
          <div class="author"><img src="https://example.com/avatar.jpg" /><p>万维钢</p></div>
          <blockquote><p>回复——</p></blockquote>
        </div>
        <p data-module-type="internal">给身体一个可承受的小压力，然后能恢复回来。</p>
        <svg><text>笔记</text></svg>
        <div><div class="em-menu">写笔记 划线 删除划线 复制</div></div>
      </div>
    `;

    const res = extractBySiteSpec(
      DEDAO_COURSE_ARTICLE_SITE_SPEC,
      'https://www.dedao.cn/course/article?id=qzNakylrn9WVaZWMjGJ7DOop10vZwL',
    );

    expect(res?.title).toBe('问答：设计结构矩阵和甘特图的区别是什么？ - 得到APP');
    expect(String(res?.textContent || '')).toContain('读者 刘福起：');
    expect(String(res?.textContent || '')).toContain(
      '请教万老师：每个月五天禁食，只喝水，这个事情是属于反脆弱，激活好细胞吗？',
    );
    expect(String(res?.textContent || '')).toContain('万维钢');
    expect(String(res?.textContent || '')).not.toContain('写笔记 划线 删除划线 复制');
    expect(String(res?.textContent || '')).not.toContain('笔记');
    expect(String(res?.contentHTML || '')).not.toContain('avatar.jpg');

    const markdown = htmlToMarkdownTurndown(
      String(res?.contentHTML || ''),
      'https://www.dedao.cn/course/article?id=qzNakylrn9WVaZWMjGJ7DOop10vZwL',
    );
    expect(markdown).toContain('读者 刘福起：');
    expect(markdown).toContain('> 请教万老师：每个月五天禁食，只喝水，这个事情是属于反脆弱，激活好细胞吗？');
    expect(markdown).toContain('万维钢');
    expect(markdown).toContain('> 回复——');
    expect(markdown).not.toContain('avatar.jpg');
    expect(markdown).not.toContain('写笔记');
  });

  it('extracts a share article title and body without the player or user messages', () => {
    document.body.innerHTML = `
      <main class="main-content">
        <div class="invoke-bar-box">打开APP</div>
        <div id="article-box">
          <header class="article-header-wrapper">
            <h1 class="article-title">952｜AI越强，我们为什么反而越忙？从一篇长文聊聊AI勤奋陷阱</h1>
          </header>
        </div>
        <div id="playerBox">00:00 10:38</div>
        <article class="article-body">
          <p>这是得到分享页的正文第一段。</p>
          <p>这是需要保留的正文第二段。</p>
        </article>
        <div class="list-top">用户留言</div>
        <section class="dd-message-list-container">
          <p>这是一条不应采集的用户留言。</p>
        </section>
      </main>
    `;

    const res = extractBySiteSpec(DEDAO_SHARE_SITE_SPEC, 'https://www.dedao.cn/share/article-id');

    expect(res?.title).toBe('952｜AI越强，我们为什么反而越忙？从一篇长文聊聊AI勤奋陷阱');
    expect(String(res?.textContent || '')).toContain('这是得到分享页的正文第一段。');
    expect(String(res?.textContent || '')).not.toContain('用户留言');
    expect(String(res?.textContent || '')).not.toContain('这是一条不应采集的用户留言。');
    expect(String(res?.contentHTML || '')).not.toContain('article-header-wrapper');
    expect(String(res?.contentHTML || '')).not.toContain('dd-message-list-container');
  });
});
