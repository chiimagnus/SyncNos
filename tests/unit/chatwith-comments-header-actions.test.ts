import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadChatWithSettingsMock = vi.fn();
const buildChatWithPayloadMock = vi.fn();
const writeTextToClipboardMock = vi.fn();
const openChatWithPlatformMock = vi.fn();

vi.mock('../../src/services/integrations/chatwith/chatwith-settings', async () => {
  const actual = await vi.importActual('../../src/services/integrations/chatwith/chatwith-settings');
  return {
    ...(actual as Record<string, unknown>),
    loadChatWithSettings: (...args: any[]) => loadChatWithSettingsMock(...args),
    buildChatWithPayload: (...args: any[]) => buildChatWithPayloadMock(...args),
  };
});

vi.mock('../../src/services/shared/clipboard', () => ({
  writeTextToClipboard: (...args: any[]) => writeTextToClipboardMock(...args),
}));

vi.mock('../../src/services/integrations/chatwith/chatwith-open-port', () => ({
  openChatWithPlatform: (...args: any[]) => openChatWithPlatformMock(...args),
}));

describe('resolveChatWithCommentsHeaderActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadChatWithSettingsMock.mockResolvedValue({
      promptTemplate: '',
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    });
    buildChatWithPayloadMock.mockResolvedValue('payload\n');
    writeTextToClipboardMock.mockResolvedValue(true);
    openChatWithPlatformMock.mockResolvedValue(true);
  });

  it('passes synced URLs into the payload and opens without tab-group context', async () => {
    const { resolveChatWithCommentsHeaderActions } =
      await import('../../src/services/integrations/chatwith/chatwith-comments-header-actions');

    const actions = await resolveChatWithCommentsHeaderActions({
      conversation: {
        id: 1,
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article:https://example.com/a',
        url: 'https://example.com/a#section',
        title: 'Article',
      } as any,
      detail: {
        conversationId: 1,
        messages: [{ role: 'user', content: 'hi' }],
      } as any,
      port: {
        openExternalUrl: vi.fn().mockResolvedValue(true),
      } as any,
      openPort: {
        openPlatform: vi.fn().mockResolvedValue(true),
      },
      syncedUrls: {
        githubUrl: 'https://github.com/owner/repo/blob/main/Articles/test.md',
      },
    });

    expect(actions).toHaveLength(1);
    await actions[0].onTrigger();

    expect(buildChatWithPayloadMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ conversationId: 1 }),
      '',
      expect.objectContaining({ githubUrl: 'https://github.com/owner/repo/blob/main/Articles/test.md' }),
    );
    expect(writeTextToClipboardMock).toHaveBeenCalledWith('payload\n');
    expect(openChatWithPlatformMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: expect.objectContaining({ id: 'chatgpt' }),
        port: expect.any(Object),
      }),
    );
    expect(openChatWithPlatformMock.mock.calls[0]?.[0]).not.toHaveProperty('context');
  });

  it('keeps ChatWith available when synced URL metadata is absent', async () => {
    const { resolveChatWithCommentsHeaderActions } =
      await import('../../src/services/integrations/chatwith/chatwith-comments-header-actions');

    const actions = await resolveChatWithCommentsHeaderActions({
      conversation: {
        id: 1,
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'chat:1',
        url: 'https://example.com/a#section',
        title: 'Chat',
      } as any,
      detail: {
        conversationId: 1,
        messages: [{ role: 'user', content: 'hi' }],
      } as any,
      port: {
        openExternalUrl: vi.fn().mockResolvedValue(true),
      } as any,
      openPort: {
        openPlatform: vi.fn().mockResolvedValue(true),
      },
    });

    expect(actions).toHaveLength(1);
    await actions[0].onTrigger();

    expect(buildChatWithPayloadMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.any(Object),
      '',
      {},
    );
    expect(openChatWithPlatformMock.mock.calls[0]?.[0]).not.toHaveProperty('context');
  });
});
