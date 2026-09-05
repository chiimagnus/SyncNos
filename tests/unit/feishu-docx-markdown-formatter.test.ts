import { describe, expect, it } from 'vitest';

import { formatConversationMarkdownForFeishuDocxSync } from '@services/sync/feishu/docx/feishu-docx-markdown';

describe('feishu docx markdown formatter', () => {
  it('uses H1 for role labels (content/user/assistant) to improve Feishu render prominence', async () => {
    const out = await formatConversationMarkdownForFeishuDocxSync(
      { id: 1, source: 'x', conversationKey: 'k', title: 't' } as any,
      {
        conversationId: 1,
        messages: [
          { id: 1, conversationId: 1, messageKey: 'm1', role: 'content', contentText: 'a' } as any,
          { id: 2, conversationId: 1, messageKey: 'm2', role: 'user', contentText: 'b' } as any,
          { id: 3, conversationId: 1, messageKey: 'm3', role: 'assistant', contentText: 'c' } as any,
        ],
      } as any,
    );

    expect(out).toContain('\n# content\n');
    expect(out).toContain('\n# You\n');
    expect(out).toContain('\n# assistant\n');
    expect(out).not.toContain('\n## content\n');
    expect(out).not.toContain('\n## You\n');
    expect(out).not.toContain('\n## assistant\n');
  });

  it('uses H1 for article Content section in Feishu sync output', async () => {
    const out = await formatConversationMarkdownForFeishuDocxSync(
      { id: 1, source: 'x', conversationKey: 'k', title: 't', sourceType: 'article' } as any,
      {
        conversationId: 1,
        messages: [{ id: 1, conversationId: 1, messageKey: 'm1', role: 'content', contentText: 'body' } as any],
      } as any,
    );

    expect(out).toContain('\n# Content\n');
    expect(out).not.toContain('\n## Content\n');
  });

  it('keeps internal image references (data url / syncnos-asset)', async () => {
    const markdown = ['# Title', '', '![d](data:image/png;base64,AAAA)', '', '![a](syncnos-asset://123)', ''].join(
      '\n',
    );

    const out = await formatConversationMarkdownForFeishuDocxSync(
      { id: 1, source: 'x', conversationKey: 'k', title: 't' } as any,
      {
        conversationId: 1,
        messages: [
          {
            id: 1,
            conversationId: 1,
            messageKey: 'm1',
            role: 'user',
            contentMarkdown: markdown,
          } as any,
        ],
      } as any,
    );

    expect(out).toContain('data:image/png;base64,AAAA');
    expect(out).toContain('syncnos-asset://123');
    expect(out).not.toContain('[Image omitted]');
  });

  it('does not normalize image-looking caption lines inside fenced or indented code', async () => {
    const markdown = [
      '```md',
      '![code](https://example.com/code.png)Code caption',
      '```',
      '',
      '    ![indent](https://example.com/i.png)Indented caption',
    ].join('\n');
    const out = await formatConversationMarkdownForFeishuDocxSync(
      { id: 1, source: 'x', conversationKey: 'k', title: 't' } as any,
      {
        conversationId: 1,
        messages: [{ id: 1, conversationId: 1, messageKey: 'm1', role: 'assistant', contentMarkdown: markdown } as any],
      } as any,
    );

    expect(out).toContain('![code](https://example.com/code.png)Code caption');
    expect(out).toContain('    ![indent](https://example.com/i.png)Indented caption');
  });

  it('normalizes standalone image caption lines', async () => {
    const markdown = ['![alt](https://example.com/a.png)Caption'].join('\n');
    const out = await formatConversationMarkdownForFeishuDocxSync(
      { id: 1, source: 'x', conversationKey: 'k', title: 't' } as any,
      {
        conversationId: 1,
        messages: [
          {
            id: 1,
            conversationId: 1,
            messageKey: 'm1',
            role: 'assistant',
            contentMarkdown: markdown,
          } as any,
        ],
      } as any,
    );

    expect(out).toContain('![alt](https://example.com/a.png)\n\nCaption');
  });
});
