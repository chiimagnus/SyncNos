import { describe, expect, it } from 'vitest';

import { formatConversationMarkdownForExternalOutput } from '@services/integrations/chatwith/chatwith-settings';

describe('ChatWith image routing', () => {
  it('keeps external output backend-neutral by replacing internal assets with placeholders', async () => {
    await expect(
      formatConversationMarkdownForExternalOutput(
        {
          id: 1,
          source: 'chatgpt',
          conversationKey: 'thread-1',
          title: 'Thread',
        } as any,
        {
          conversationId: 1,
          messages: [
            {
              id: 1,
              conversationId: 1,
              messageKey: 'm1',
              role: 'assistant',
              contentMarkdown: '![x](syncnos-asset://7)',
            },
          ],
        } as any,
      ),
    ).resolves.toContain('[Image: x]');
  });
});
