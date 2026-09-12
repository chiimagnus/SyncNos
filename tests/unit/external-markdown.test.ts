import { describe, expect, it } from 'vitest';

import { formatConversationMarkdownForExternalOutput } from '../../src/services/conversations/external-markdown';

describe('formatConversationMarkdownForExternalOutput', () => {
  it('inherits the semantic Video document projection and still sanitizes internal image targets', async () => {
    const markdown = await formatConversationMarkdownForExternalOutput(
      {
        id: 2,
        sourceType: 'video',
        source: 'video',
        conversationKey: 'video:https://example.com/watch/2',
        title: 'Video',
        url: 'https://example.com/watch/2',
        author: 'Creator',
        platform: 'youtube',
        videoDescription: 'Description body',
        lastActivityAt: Date.parse('2026-09-08T01:02:03.000Z'),
      } as any,
      {
        conversationId: 2,
        messages: [
          {
            id: 2,
            conversationId: 2,
            messageKey: 'video_transcript',
            role: 'transcript',
            contentMarkdown: '[00:01.234] hello\n\n![Cached](syncnos-asset://42)',
            videoChapters: [{ title: 'Intro', startSeconds: 0, endSeconds: 10 }],
          },
        ],
      },
    );

    expect(markdown).toContain('## Description\n\nDescription body');
    expect(markdown).toContain('## Chapters\n\n- [00:00 → 00:10] Intro');
    expect(markdown).toContain('## Transcript\n\n[00:01.234] hello');
    expect(markdown).toContain('[Image: Cached]');
    expect(markdown).not.toContain('syncnos-asset://42');
    expect(markdown).not.toContain('## transcript');
  });

  it('materializes internal image references without leaking embedded image payloads', async () => {
    const markdown = await formatConversationMarkdownForExternalOutput(
      {
        id: 1,
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/a',
        title: 'Article',
        url: 'https://example.com/a',
        lastActivityAt: Date.parse('2026-09-08T01:02:03.000Z'),
      },
      {
        conversationId: 1,
        messages: [
          {
            id: 1,
            conversationId: 1,
            messageKey: 'm1',
            role: 'system',
            contentMarkdown: [
              'before',
              '![Diagram](data:image/png;base64,AAAA)',
              '![Cached](syncnos-asset://42)',
              '![Malformed](syncnos-asset://nope)',
              '![Zero](syncnos-asset://0)',
              '![Remote](https://example.com/remote.png)',
              '`![InlineCode](syncnos-asset://77)`',
              '```md',
              '![Fenced](data:image/png;base64,BBBB)',
              '![FencedInternal](syncnos-asset://88)',
              '```',
              '    ![Indented](syncnos-asset://99)',
              'after',
            ].join('\n'),
          },
        ],
      },
    );

    expect(markdown).toContain('- Last Activity: 2026-09-08T01:02:03.000Z');
    expect(markdown).toContain('[Image: Diagram]');
    expect(markdown).toContain('[Image: Cached]');
    expect(markdown).toContain('[Image: Malformed]');
    expect(markdown).toContain('[Image: Zero]');
    expect(markdown).toContain('![Remote](https://example.com/remote.png)');
    expect(markdown).not.toContain('data:image/png;base64,AAAA');
    expect(markdown).not.toContain('![Cached](syncnos-asset://42)');
    expect(markdown).toContain('`![InlineCode](syncnos-asset://77)`');
    expect(markdown).toContain('![Fenced](data:image/png;base64,BBBB)');
    expect(markdown).toContain('![FencedInternal](syncnos-asset://88)');
    expect(markdown).toContain('    ![Indented](syncnos-asset://99)');
  });
});
