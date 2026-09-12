import { describe, expect, it } from 'vitest';

import { countConversationMessageTextUnits, countTextUnits } from '@services/conversations/domain/text-count';

describe('countTextUnits', () => {
  it.each([
    ['这是一个测试。', 6],
    ['中文 English words 混排测试 123。', 9],
    ['Hello world', 2],
    ['ChatGPT-5.6 works', 2],
    ['state-of-the-art user@example.com v1.2.3', 3],
    ['https://example.com/a?q=1', 0],
    ['See https://example.com/a?q=1 now', 2],
    ['详见https://example.com（测试）', 4],
    ['详见 https://example.com/path。测试', 4],
    ['https://例子.测试/路径 中文', 2],
    ['日本語テスト', 6],
    ['안녕하세요', 5],
    ['〆ー〇', 3],
    ['。、，', 0],
    ['👨‍👩‍👧‍👦', 0],
    ['🙂🚀', 0],
    ['1️⃣', 0],
    ['1', 1],
    ['A🙂B', 2],
    ['A1️⃣B', 2],
    ['abc中def', 3],
    ['foo_bar', 1],
    ['foo--bar', 2],
    ['HTTPS://EXAMPLE.COM', 0],
    ['https://example.com/path?x=中文 后', 1],
    ['https://example.com/path）测试', 2],
    ['https://a.com,word', 1],
    ['https://en.wikipedia.org/wiki/Function_(mathematics)', 0],
    ['See https://en.wikipedia.org/wiki/Function_(mathematics) now', 2],
    ['https://example.com/a_(b_(c)) tail', 1],
    ['http://[::1]/', 0],
    ['See http://[::1]/ now', 2],
    ['(https://example.com)', 0],
    ['https://example.com/test)word', 1],
    ['example.com', 1],
    ['   \n\t', 0],
  ])('counts %j deterministically as %i', (text, expected) => {
    expect(countTextUnits(text)).toBe(expected);
  });

  it('normalizes canonically equivalent Unicode before counting', () => {
    expect(countTextUnits('ガ')).toBe(1);
    expect(countTextUnits('ガ')).toBe(1);
    expect(countTextUnits('한글')).toBe(2);
    expect(countTextUnits('한글')).toBe(2);
    expect(countTextUnits('e\u0301')).toBe(1);
    expect(countTextUnits('é')).toBe(1);
  });
});

describe('countConversationMessageTextUnits', () => {
  it('derives counts from the canonical Markdown body', () => {
    expect(
      countConversationMessageTextUnits([
        {
          contentMarkdown: '00:01 **你好世界** ![](https://example.com/image.png)',
        },
      ]),
    ).toBe(5);
  });

  it('counts formatted Markdown text semantically', () => {
    expect(countConversationMessageTextUnits([{ contentMarkdown: '**测试**' }])).toBe(2);
  });

  it('supports Markdown messages and empty messages', () => {
    expect(countConversationMessageTextUnits([{ contentMarkdown: '**legacy**' }, {}])).toBe(1);
  });

  it('sums each message independently', () => {
    expect(countConversationMessageTextUnits([{ contentMarkdown: '中文' }, { contentMarkdown: 'Hello world' }])).toBe(
      4,
    );
  });

  it('ignores image targets while counting visible Markdown text', () => {
    expect(
      countConversationMessageTextUnits([
        {
          contentMarkdown: '**old content with many words** ![](syncnos-asset://123)',
        },
      ]),
    ).toBe(5);
  });

  it('projects visible Markdown text without counting link targets or images', () => {
    expect(
      countConversationMessageTextUnits([
        {
          contentMarkdown: '**测试** [OpenAI](https://openai.com) ![图片说明](https://example.com/a.png)',
        },
      ]),
    ).toBe(3);
  });

  it('treats an image token as a text boundary without counting its alt text', () => {
    expect(
      countConversationMessageTextUnits([{ contentMarkdown: 'before ![图片说明](https://example.com/a.png) after' }]),
    ).toBe(2);
  });

  it('does not count a Markdown link whose visible label is itself a URL', () => {
    expect(countConversationMessageTextUnits([{ contentMarkdown: '[https://example.com](https://example.com)' }])).toBe(
      0,
    );
  });

  it('keeps visible heading, list, blockquote, and table-cell text', () => {
    const markdown = '# 标题\n\n> quote\n\n- item\n\n| 名称 | Value |\n|---|---|\n| 测试 | two words |';
    expect(countConversationMessageTextUnits([{ contentMarkdown: markdown }])).toBe(11);
  });

  it('counts inline and fenced code bodies without counting Markdown fences or language markers', () => {
    const markdown = '`npm run test`\n\n```ts\nconst x = 1;\n```';
    expect(countConversationMessageTextUnits([{ contentMarkdown: markdown }])).toBe(6);
  });

  it('preserves indented-code and nested-list structure through the source resolver', () => {
    const markdown = '    indented code\n\n- outer\n  - nested';
    expect(countConversationMessageTextUnits([{ contentMarkdown: markdown }])).toBe(4);
  });

  it('returns zero for image-only Markdown', () => {
    expect(countConversationMessageTextUnits([{ contentMarkdown: '![图片说明](https://example.com/a.png)' }])).toBe(0);
  });

  it('keeps the production pure-image article shape at zero', () => {
    expect(
      countConversationMessageTextUnits([
        {
          contentMarkdown: '![第一张](https://example.com/image-1.png)\n![第二张](https://example.com/image-2.png)',
        },
      ]),
    ).toBe(0);
  });

  it('derives timestamp-free text for saved video transcripts across old and canonical time formats', () => {
    expect(
      countConversationMessageTextUnits([
        {
          messageKey: 'video_transcript',
          contentMarkdown: [
            '00:01 你好 world',
            '01:02:03 next line',
            '[00:01.234] alpha beta',
            '[00:01.234 → 00:03.456] gamma',
            '[01:02:03.004 → 01:02:05.006] delta',
          ].join('\n'),
        },
      ]),
    ).toBe(9);
  });

  it('keeps timestamp-like text for ordinary messages', () => {
    expect(countConversationMessageTextUnits([{ messageKey: 'm1', contentMarkdown: '00:01 你好 world' }])).toBe(4);
    expect(
      countConversationMessageTextUnits([{ messageKey: 'm1', contentMarkdown: '[00:01.234 → 00:03.456] gamma' }]),
    ).toBeGreaterThan(1);
  });

  it('counts source-site comments when the collector includes them in saved Markdown', () => {
    expect(countConversationMessageTextUnits([{ contentMarkdown: '正文\n评论区\nnice comment' }])).toBe(7);
  });
});
