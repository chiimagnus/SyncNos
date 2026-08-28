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
              '![Remote](https://example.com/remote.png)',
              'after',
            ].join('\n'),
          },
        ],
      },
    );

    expect(markdown).toContain('[Image: Diagram]');
    expect(markdown).toContain('[Image: Cached]');
    expect(markdown).toContain('![Remote](https://example.com/remote.png)');
    expect(markdown).not.toContain('data:image/png;base64,AAAA');
    expect(markdown).not.toContain('syncnos-asset://42');
  });
});
