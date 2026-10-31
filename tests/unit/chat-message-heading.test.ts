import { describe, expect, it } from 'vitest';

import { escapeMarkdownHeading, formatChatMessageHeading } from '@services/conversations/domain/chat-message-heading';

describe('chat message export headings', () => {
  it('numbers from persisted zero-based sequences, including incremental batches', () => {
    expect(
      formatChatMessageHeading({ sequence: 0, role: 'user', contentMarkdown: '什么是日报和周报？后面还有内容。' }),
    ).toBe('01 · You — 什么是日报和周报？');
    expect(
      formatChatMessageHeading({ sequence: 11, role: 'assistant', contentMarkdown: '周报通常包含以下部分。' }),
    ).toBe('12 · Assistant — 周报通常包含以下部分。');
    expect(formatChatMessageHeading({ role: 'user', contentMarkdown: 'No sequence.' }, 7)).toBe(
      '08 · You — No sequence.',
    );
    expect(formatChatMessageHeading({ sequence: -1, role: 'user', contentMarkdown: '' }, 2)).toBe('03 · You');
  });

  it('keeps author names and standard non-chat roles', () => {
    expect(
      formatChatMessageHeading({
        sequence: 0,
        role: 'user',
        authorName: 'Alice',
        contentMarkdown: 'Hello world. Next.',
      }),
    ).toBe('01 · Alice — Hello world.');
    expect(formatChatMessageHeading({ sequence: 1, role: 'tool', contentMarkdown: 'Task done' })).toBe(
      '02 · tool — Task done',
    );
  });

  it('keeps untrusted author labels on one line and bounded for Markdown and Notion headings', () => {
    expect(
      formatChatMessageHeading({
        sequence: 0,
        role: 'USER',
        authorName: '  Alice\n## Unexpected  ',
        contentMarkdown: 'Answer.',
      }),
    ).toBe('01 · Alice ## Unexpected — Answer.');
    const heading = formatChatMessageHeading({
      sequence: 1,
      role: 'user',
      authorName: 'A'.repeat(5000),
      contentMarkdown: 'Body',
    });
    expect(heading.length).toBeLessThan(110);
    expect(heading.includes('\n')).toBe(false);
  });

  it('uses the final answer, never the preceding saved Thinking callout', () => {
    const body = [
      '> [!NOTE]- Thinking',
      '>',
      '> 内部推理不应泄漏到目录里。',
      '',
      '**最终结论：**这是答案。细节继续。',
    ].join('\n');
    expect(formatChatMessageHeading({ sequence: 0, role: 'assistant', contentMarkdown: body })).toBe(
      '01 · Assistant — 最终结论：这是答案。',
    );
    expect(
      formatChatMessageHeading({
        sequence: 1,
        role: 'assistant',
        contentMarkdown: ['> [!NOTE]- Thinking', '>', '> only reasoning'].join('\n'),
      }),
    ).toBe('02 · Assistant');
  });

  it('extracts text from markdown and rich ChatGPT tags without including image URLs', () => {
    expect(
      formatChatMessageHeading({
        sequence: 0,
        role: 'user',
        contentMarkdown: '## **标题**\n\n![图](https://example.com/a.png)',
      }),
    ).toBe('01 · You — 标题 图');
    expect(
      formatChatMessageHeading({
        sequence: 1,
        role: 'assistant',
        contentMarkdown: '<row><box>**方法概述**</box></row>\n<divider color="subtle"/>',
      }),
    ).toBe('02 · Assistant — 方法概述');
    expect(
      formatChatMessageHeading({
        sequence: 2,
        role: 'assistant',
        contentMarkdown: '![image](data:image/png;base64,AAAA)',
      }),
    ).toBe('03 · Assistant — image');
  });

  it('does not split numeric decimals and preserves one-line headings', () => {
    expect(
      formatChatMessageHeading({
        sequence: 0,
        role: 'user',
        contentMarkdown: 'Version 3.14 is stable. Details below.',
      }),
    ).toBe('01 · You — Version 3.14 is stable.');
    expect(formatChatMessageHeading({ sequence: 1, role: 'user', contentMarkdown: '你好！接下来是长句。' })).toBe(
      '02 · You — 你好！',
    );
  });

  it('caps very long unicode headings without splitting surrogate pairs or altering source content', () => {
    const body = '长期讨论'.repeat(10000);
    const title = formatChatMessageHeading({ role: 'user', contentMarkdown: body });
    expect(Array.from(title.slice(title.indexOf(' — ') + 3)).length).toBeLessThanOrEqual(65);
    expect(title.endsWith('…')).toBe(true);
    expect(formatChatMessageHeading({ sequence: 0, contentMarkdown: '' })).toBe('01 · Assistant');
  });

  it('escapes markdown syntax in headings without mutating plain-text labels', () => {
    const label = formatChatMessageHeading({
      sequence: 0,
      role: 'user',
      contentMarkdown: 'Use *raw* <tag> and [list]?',
    });
    expect(label).toBe('01 · You — Use raw <tag> and [list]?');
    expect(escapeMarkdownHeading(label)).toBe('01 · You — Use raw \\<tag\\> and \\[list\\]?');
    expect(escapeMarkdownHeading('X \\ ` * _ [ ]')).toBe('X \\\\ \\` \\* \\_ \\[ \\]');
  });
});
