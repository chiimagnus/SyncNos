import { describe, expect, it } from 'vitest';

import { formatConversationMarkdownForExternalOutput } from '../../src/services/conversations/external-markdown';

describe('formatConversationMarkdownForExternalOutput', () => {
  it('materializes internal image references without leaking embedded image payloads', async () => {
    const markdown = await formatConversationMarkdownForExternalOutput(
      {
        id: 1,
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/a',
        title: 'Article',
        url: 'https://example.com/a',
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
