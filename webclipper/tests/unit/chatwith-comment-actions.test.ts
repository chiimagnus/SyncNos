import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadChatWithSettingsMock = vi.fn();
const truncateForChatWithMock = vi.fn();
const writeTextToClipboardMock = vi.fn();
const resolveSingleEnabledChatWithActionLabelMock = vi.fn();

vi.mock('../../src/services/integrations/chatwith/chatwith-settings', () => ({
  loadChatWithSettings: (...args: any[]) => loadChatWithSettingsMock(...args),
  truncateForChatWith: (...args: any[]) => truncateForChatWithMock(...args),
}));

vi.mock('../../src/services/integrations/chatwith/chatwith-clipboard', () => ({
  writeTextToClipboard: (...args: any[]) => writeTextToClipboardMock(...args),
}));

vi.mock('../../src/services/integrations/chatwith/chatwith-detail-header-actions', () => ({
  resolveSingleEnabledChatWithActionLabel: (...args: any[]) => resolveSingleEnabledChatWithActionLabelMock(...args),
}));

describe('resolveChatWithCommentActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      maxChars: 28000,
      platforms: [],
    });
    truncateForChatWithMock.mockImplementation((input: string) => ({
      text: String(input || ''),
      truncated: false,
    }));
    writeTextToClipboardMock.mockResolvedValue(true);
    resolveSingleEnabledChatWithActionLabelMock.mockResolvedValue(null);
  });

  it('returns empty actions when comment text is empty', async () => {
    const { resolveChatWithCommentActions } = await import('../../src/services/integrations/chatwith/chatwith-comment-actions');

    const actions = await resolveChatWithCommentActions({
      commentText: '   ',
      articleTitle: 'Title',
      canonicalUrl: 'https://example.com/article',
    });

    expect(actions).toEqual([]);
    expect(loadChatWithSettingsMock).not.toHaveBeenCalled();
  });

  it('returns empty actions when no platform is enabled', async () => {
    const { resolveChatWithCommentActions } = await import('../../src/services/integrations/chatwith/chatwith-comment-actions');

    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      maxChars: 28000,
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: false }],
    });

    const actions = await resolveChatWithCommentActions({
      commentText: 'Root comment',
      articleTitle: 'Title',
      canonicalUrl: 'https://example.com/article',
    });

    expect(actions).toEqual([]);
  });

  it('builds single-platform action and copies truncated payload', async () => {
    const { resolveChatWithCommentActions } = await import('../../src/services/integrations/chatwith/chatwith-comment-actions');

    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      maxChars: 120,
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    });
    resolveSingleEnabledChatWithActionLabelMock.mockResolvedValue('Chat with ChatGPT');
    truncateForChatWithMock.mockReturnValue({ text: 'payload-truncated\n', truncated: true });

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
    expect(writeTextToClipboardMock).toHaveBeenCalledWith('payload-truncated\n');
    expect(String(notice || '')).toContain('已复制');
    expect(String(notice || '')).toContain('ChatGPT');
    expect(String(notice || '')).toContain('truncated');

    expect(truncateForChatWithMock).toHaveBeenCalledTimes(1);
    expect(truncateForChatWithMock).toHaveBeenCalledWith(expect.any(String), 120);

    const payloadArg = String(truncateForChatWithMock.mock.calls[0]?.[0] || '');
    expect(payloadArg).toContain('Article Title: My Article');
    expect(payloadArg).toContain('Article URL: https://example.com/article');
    expect(payloadArg).toContain('Quote:');
    expect(payloadArg).toContain('Selected quote');
    expect(payloadArg).toContain('Comment:');
    expect(payloadArg).toContain('Root comment text');
    expect(payloadArg.endsWith('\n')).toBe(true);
  });

  it('builds multi-platform actions without single-label resolver', async () => {
    const { resolveChatWithCommentActions } = await import('../../src/services/integrations/chatwith/chatwith-comment-actions');

    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      maxChars: 28000,
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
    const { resolveChatWithCommentActions } = await import('../../src/services/integrations/chatwith/chatwith-comment-actions');

    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      maxChars: 28000,
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    });
    writeTextToClipboardMock.mockResolvedValue(false);

    const actions = await resolveChatWithCommentActions({
      commentText: 'Root comment text',
      articleTitle: 'My Article',
      canonicalUrl: 'https://example.com/article',
    });

    await expect(actions[0].onTrigger()).rejects.toThrow('Failed to copy content to clipboard');
  });
});
