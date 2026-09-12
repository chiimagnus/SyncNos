import { describe, expect, it } from 'vitest';

import { formatConversationMarkdownForFeishuDocxSync } from '@services/sync/feishu/docx/feishu-docx-markdown';

describe('feishu docx markdown formatter', () => {
  it('uses H1 for role labels (content/user/assistant) to improve Feishu render prominence', async () => {
    const out = await formatConversationMarkdownForFeishuDocxSync(
      {
        id: 1,
        source: 'x',
        conversationKey: 'k',
        title: 't',
        lastActivityAt: Date.parse('2026-09-08T01:02:03.000Z'),
      } as any,
      {
        conversationId: 1,
        messages: [
          { id: 1, conversationId: 1, messageKey: 'm1', role: 'content', contentMarkdown: 'a' } as any,
          { id: 2, conversationId: 1, messageKey: 'm2', role: 'user', contentMarkdown: 'b' } as any,
          { id: 3, conversationId: 1, messageKey: 'm3', role: 'assistant', contentMarkdown: 'c' } as any,
        ],
      } as any,
    );

    expect(out).toContain('- Last Activity: 2026-09-08T01:02:03.000Z');
    expect(out).toContain('\n# content\n');
    expect(out).toContain('\n# You\n');
    expect(out).toContain('\n# assistant\n');
    expect(out).not.toContain('\n## content\n');
    expect(out).not.toContain('\n## You\n');
    expect(out).not.toContain('\n## assistant\n');
  });

  it('uses H1 for article Content section in Feishu sync output', async () => {
    const out = await formatConversationMarkdownForFeishuDocxSync(
      {
        id: 1,
        source: 'x',
        conversationKey: 'k',
        title: 't',
        sourceType: 'article',
        lastActivityAt: Date.parse('2026-09-08T04:05:06.000Z'),
      } as any,
      {
        conversationId: 1,
        messages: [{ id: 1, conversationId: 1, messageKey: 'm1', role: 'content', contentMarkdown: 'body' } as any],
      } as any,
    );

    expect(out).toContain('- Last Activity: 2026-09-08T04:05:06.000Z');
    expect(out.indexOf('- Last Activity:')).toBeLessThan(out.indexOf('\n# Content\n'));
    expect(out).toContain('\n# Content\n');
    expect(out).not.toContain('\n## Content\n');
  });

  it('inherits the semantic Video document without chat role headings', async () => {
    const out = await formatConversationMarkdownForFeishuDocxSync(
      {
        id: 2,
        source: 'video',
        sourceType: 'video',
        conversationKey: 'video:https://example.com/watch/2',
        title: 'Video',
        url: 'https://example.com/watch/2',
        author: 'Creator',
        platform: 'bilibili',
        durationSeconds: 60,
        videoDescription: 'Description body',
      } as any,
      {
        conversationId: 2,
        messages: [
          {
            id: 2,
            conversationId: 2,
            messageKey: 'video_transcript',
            role: 'transcript',
            contentMarkdown: '[00:01.234] hello',
            videoChapters: [{ title: 'Intro', startSeconds: 0, endSeconds: 30 }],
          } as any,
        ],
      } as any,
    );

    expect(out).toContain('- Platform: bilibili');
    expect(out).toContain('## Description\n\nDescription body');
    expect(out).toContain('## Chapters\n\n- [00:00 → 00:30] Intro');
    expect(out).toContain('## Transcript\n\n[00:01.234] hello');
    expect(out).not.toContain('# Conversations');
    expect(out).not.toContain('# transcript');
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY, 9e99])(
    'omits invalid Last Activity metadata for %s',
    async (lastActivityAt) => {
      const out = await formatConversationMarkdownForFeishuDocxSync(
        { id: 1, source: 'x', conversationKey: 'k', title: 't', lastActivityAt } as any,
        { conversationId: 1, messages: [] } as any,
      );
      expect(out).not.toContain('Last Activity:');
      expect(out).not.toContain('Infinity');
    },
  );

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
