import { describe, expect, it, vi } from 'vitest';

import {
  formatConversationMarkdownForExternalOutput,
  materializeMarkdownAssetPaths,
} from '@services/integrations/chatwith/chatwith-settings';

describe('ChatWith image routing', () => {
  it('uses only an injected resolver when materializing an internal image path', async () => {
    const resolveImageAsset = vi.fn(async (assetId: number) =>
      assetId === 7 ? { contentType: 'image/jpeg', url: 'https://example.com/photo.jpeg' } : null,
    );

    await expect(
      materializeMarkdownAssetPaths({
        markdown: 'before\n\n![photo](syncnos-asset://7)\n',
        markdownBasename: 'conversation',
        resolveImageAsset,
      }),
    ).resolves.toBe('before\n\n![photo](conversation-1.jpg)\n');
    expect(resolveImageAsset).toHaveBeenCalledTimes(1);
    expect(resolveImageAsset).toHaveBeenCalledWith(7);
  });

  it('keeps the external formatter pure and surfaces a missing resolver instead of reading IDB', async () => {
    await expect(
      materializeMarkdownAssetPaths({
        markdown: '![photo](syncnos-asset://7)',
        markdownBasename: 'conversation',
        resolveImageAsset: undefined as any,
      }),
    ).rejects.toThrow('image asset resolver unavailable');

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
