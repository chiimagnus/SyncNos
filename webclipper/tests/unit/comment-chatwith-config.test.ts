import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveChatWithCommentActionsMock = vi.fn();

vi.mock('../../src/services/integrations/chatwith/chatwith-comment-actions', () => ({
  resolveChatWithCommentActions: (...args: any[]) => resolveChatWithCommentActionsMock(...args),
}));

describe('createThreadedCommentChatWithConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveChatWithCommentActionsMock.mockResolvedValue([]);
  });

  it('normalizes resolver context payload', async () => {
    const { createThreadedCommentChatWithConfig } = await import('../../src/ui/comments/comment-chatwith-config');

    const config = createThreadedCommentChatWithConfig({
      resolveContext: async () => ({
        articleTitle: '  Example Article  ',
        canonicalUrl: '  https://example.com/article  ',
      }),
    });

    await expect(config.resolveContext?.()).resolves.toEqual({
      articleTitle: 'Example Article',
      canonicalUrl: 'https://example.com/article',
    });
  });

  it('forwards normalized context and open port when resolving actions', async () => {
    const { createThreadedCommentChatWithConfig } = await import('../../src/ui/comments/comment-chatwith-config');

    const openPort = {
      openPlatform: vi.fn(async () => true),
    };

    const expectedActions = [
      {
        id: 'chat-with-chatgpt',
        label: 'Chat with ChatGPT',
      },
    ];
    resolveChatWithCommentActionsMock.mockResolvedValue(expectedActions);

    const config = createThreadedCommentChatWithConfig({
      resolveContext: async () => ({
        articleTitle: 'Article from resolver',
        canonicalUrl: 'https://example.com/resolver',
      }),
      resolveOpenPort: async () => openPort,
    });

    const actions = await config.resolveActions(
      {
        id: 1,
        parentId: null,
        quoteText: 'Selected quote',
        commentText: 'Root comment',
      },
      {
        articleTitle: ' Article from context ',
        canonicalUrl: ' https://example.com/context ',
      },
    );

    expect(actions).toEqual(expectedActions);
    expect(resolveChatWithCommentActionsMock).toHaveBeenCalledTimes(1);
    expect(resolveChatWithCommentActionsMock).toHaveBeenCalledWith({
      quoteText: 'Selected quote',
      commentText: ['Reply 1:', 'Root comment'].join('\n'),
      articleTitle: 'Article from context',
      canonicalUrl: 'https://example.com/context',
      openPort,
    });
  });

  it('returns empty actions when disabled by gate', async () => {
    const { createThreadedCommentChatWithConfig } = await import('../../src/ui/comments/comment-chatwith-config');

    const config = createThreadedCommentChatWithConfig({
      resolveContext: async () => ({
        articleTitle: 'Example Article',
        canonicalUrl: 'https://example.com/article',
      }),
      isEnabled: () => false,
    });

    const actions = await config.resolveActions(
      {
        id: 1,
        parentId: null,
        quoteText: '',
        commentText: 'Root comment',
      },
      {
        articleTitle: 'Example Article',
        canonicalUrl: 'https://example.com/article',
      },
    );

    expect(actions).toEqual([]);
    expect(resolveChatWithCommentActionsMock).not.toHaveBeenCalled();
  });

  it('includes reply text when resolving actions', async () => {
    const { createThreadedCommentChatWithConfig } = await import('../../src/ui/comments/comment-chatwith-config');

    resolveChatWithCommentActionsMock.mockResolvedValue([]);

    const config = createThreadedCommentChatWithConfig({
      resolveContext: async () => ({
        articleTitle: 'Example Article',
        canonicalUrl: 'https://example.com/article',
      }),
    });

    await config.resolveActions(
      {
        id: 1,
        parentId: null,
        quoteText: 'Selected quote',
        authorName: 'Chii',
        commentText: 'Root comment',
      },
      {
        articleTitle: 'Example Article',
        canonicalUrl: 'https://example.com/article',
      },
      [
        {
          id: 2,
          parentId: 1,
          authorName: 'Alice',
          quoteText: null,
          commentText: 'First reply',
        },
        {
          id: 3,
          parentId: 1,
          authorName: 'Bob',
          quoteText: null,
          commentText: 'Second reply',
        },
      ],
    );

    expect(resolveChatWithCommentActionsMock).toHaveBeenCalledTimes(1);
    expect(resolveChatWithCommentActionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteText: 'Selected quote',
        commentText: [
          'Reply 1 (Chii):',
          'Root comment',
          '',
          'Reply 2 (Alice):',
          'First reply',
          '',
          'Reply 3 (Bob):',
          'Second reply',
        ].join('\n'),
      }),
    );
  });
});
