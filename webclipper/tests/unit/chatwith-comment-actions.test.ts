import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadChatWithSettingsMock = vi.fn();
const writeTextToClipboardMock = vi.fn();
const resolveSingleEnabledChatWithActionLabelMock = vi.fn();
const openChatWithPlatformMock = vi.fn();

vi.mock('../../src/services/integrations/chatwith/chatwith-settings', async () => {
  const actual = await vi.importActual('../../src/services/integrations/chatwith/chatwith-settings');
  return {
    ...(actual as Record<string, unknown>),
    loadChatWithSettings: (...args: any[]) => loadChatWithSettingsMock(...args),
  };
});

vi.mock('../../src/services/integrations/chatwith/chatwith-clipboard', () => ({
  writeTextToClipboard: (...args: any[]) => writeTextToClipboardMock(...args),
}));

vi.mock('../../src/services/integrations/chatwith/chatwith-comments-header-actions', () => ({
  resolveSingleEnabledChatWithActionLabel: (...args: any[]) => resolveSingleEnabledChatWithActionLabelMock(...args),
}));

vi.mock('../../src/services/integrations/chatwith/chatwith-open-port', () => ({
  openChatWithPlatform: (...args: any[]) => openChatWithPlatformMock(...args),
}));

describe('resolveChatWithCommentActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      platforms: [],
    });
    writeTextToClipboardMock.mockResolvedValue(true);
    resolveSingleEnabledChatWithActionLabelMock.mockResolvedValue(null);
    openChatWithPlatformMock.mockResolvedValue(true);
  });

  it('returns empty actions when comment text is empty', async () => {
    const { resolveChatWithCommentActions } =
      await import('../../src/services/integrations/chatwith/chatwith-comment-actions');

    const actions = await resolveChatWithCommentActions({
      commentText: '   ',
      articleTitle: 'Title',
      canonicalUrl: 'https://example.com/article',
    });

    expect(actions).toEqual([]);
    expect(loadChatWithSettingsMock).not.toHaveBeenCalled();
  });

  it('returns empty actions when no platform is enabled', async () => {
    const { resolveChatWithCommentActions } =
      await import('../../src/services/integrations/chatwith/chatwith-comment-actions');

    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: false }],
    });

    const actions = await resolveChatWithCommentActions({
      commentText: 'Root comment',
      articleTitle: 'Title',
      canonicalUrl: 'https://example.com/article',
    });

    expect(actions).toEqual([]);
  });

  it('builds single-platform action and copies full payload', async () => {
    const { resolveChatWithCommentActions } =
      await import('../../src/services/integrations/chatwith/chatwith-comment-actions');

    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    });
    resolveSingleEnabledChatWithActionLabelMock.mockResolvedValue('Chat with ChatGPT');

    const actions = await resolveChatWithCommentActions({
      quoteText: 'Selected quote',
      commentText: 'Root comment text',
      articleTitle: 'My Article',
      canonicalUrl: 'https://example.com/article',
    });

    expect(actions.length).toBe(1);
    expect(actions[0].id).toBe('chat-with-chatgpt');
    expect(actions[0].label).toBe('Chat with ChatGPT');

    const notice = await actions[0].onTrigger();

    expect(writeTextToClipboardMock).toHaveBeenCalledTimes(1);
    expect(writeTextToClipboardMock).toHaveBeenCalledWith(expect.any(String));
    expect(openChatWithPlatformMock).toHaveBeenCalledTimes(1);
    expect(openChatWithPlatformMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: expect.objectContaining({ id: 'chatgpt', name: 'ChatGPT' }),
        context: expect.objectContaining({ articleKey: 'https://example.com/article' }),
      }),
    );
    expect(String(notice || '')).toContain('已复制');
    expect(String(notice || '')).toContain('ChatGPT');

    const payloadArg = String(writeTextToClipboardMock.mock.calls[0]?.[0] || '');
    expect(payloadArg).toContain('Article Title: My Article');
    expect(payloadArg).toContain('Article URL: https://example.com/article');
    expect(payloadArg).toContain('Quote:');
    expect(payloadArg).toContain('Selected quote');
    expect(payloadArg).toContain('Root comment text');
    expect(payloadArg.endsWith('\n')).toBe(true);
  });

  it('builds multi-platform actions without single-label resolver', async () => {
    const { resolveChatWithCommentActions } =
      await import('../../src/services/integrations/chatwith/chatwith-comment-actions');

    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      platforms: [
        { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true },
        { id: 'claude', name: 'Claude', url: 'https://claude.ai/', enabled: true },
      ],
    });

    const actions = await resolveChatWithCommentActions({
      commentText: 'Root comment text',
      articleTitle: 'My Article',
      canonicalUrl: 'https://example.com/article',
    });

    expect(actions.map((item) => item.id)).toEqual(['chat-with-chatgpt', 'chat-with-claude']);
    expect(actions.map((item) => item.label)).toEqual(['Chat with ChatGPT', 'Chat with Claude']);
    expect(resolveSingleEnabledChatWithActionLabelMock).not.toHaveBeenCalled();
  });

  it('throws when clipboard copy fails', async () => {
    const { resolveChatWithCommentActions } =
      await import('../../src/services/integrations/chatwith/chatwith-comment-actions');

    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    });
    writeTextToClipboardMock.mockResolvedValue(false);

    const actions = await resolveChatWithCommentActions({
      commentText: 'Root comment text',
      articleTitle: 'My Article',
      canonicalUrl: 'https://example.com/article',
    });

    await expect(actions[0].onTrigger()).rejects.toThrow('Failed to copy content to clipboard');
    expect(openChatWithPlatformMock).not.toHaveBeenCalled();
  });

  it('throws when opening platform fails', async () => {
    const { resolveChatWithCommentActions } =
      await import('../../src/services/integrations/chatwith/chatwith-comment-actions');

    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    });
    openChatWithPlatformMock.mockResolvedValue(false);

    const actions = await resolveChatWithCommentActions({
      commentText: 'Root comment text',
      articleTitle: 'My Article',
      canonicalUrl: 'https://example.com/article',
    });

    await expect(actions[0].onTrigger()).rejects.toThrow('Failed to open ChatGPT');
  });
});
