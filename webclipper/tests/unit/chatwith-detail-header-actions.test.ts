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

vi.mock('../../src/services/integrations/chatwith/chatwith-clipboard', () => ({
  writeTextToClipboard: (...args: any[]) => writeTextToClipboardMock(...args),
}));

vi.mock('../../src/services/integrations/chatwith/chatwith-open-port', () => ({
  openChatWithPlatform: (...args: any[]) => openChatWithPlatformMock(...args),
}));

describe('resolveChatWithDetailHeaderActions', () => {
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

  it('passes articleKey context to openPort when conversation is an article', async () => {
    const { resolveChatWithDetailHeaderActions } =
      await import('../../src/services/integrations/chatwith/chatwith-detail-header-actions');

    const actions = await resolveChatWithDetailHeaderActions({
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
    });

    expect(actions).toHaveLength(1);
    await actions[0].onTrigger();

    expect(writeTextToClipboardMock).toHaveBeenCalledWith('payload\n');
    expect(openChatWithPlatformMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ articleKey: 'https://example.com/a' }),
      }),
    );
  });

  it('does not pass articleKey context for non-article conversations', async () => {
    const { resolveChatWithDetailHeaderActions } =
      await import('../../src/services/integrations/chatwith/chatwith-detail-header-actions');

    const actions = await resolveChatWithDetailHeaderActions({
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

    expect(openChatWithPlatformMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: null,
      }),
    );
  });
});
