import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsCreate: vi.fn(),
  tabsQuery: vi.fn(),
  tabsGet: vi.fn(),
  tabsUpdate: vi.fn(),
  tabsSendMessage: vi.fn(),
  tabsRemove: vi.fn(),
}));

vi.mock('../../src/services/integrations/chatwith/chatwith-settings', async () => {
  const actual = await vi.importActual('../../src/services/integrations/chatwith/chatwith-settings');
  return {
    ...(actual as Record<string, unknown>),
    loadChatWithSettings: vi.fn(),
  };
});

import { tabsCreate } from '../../src/platform/webext/tabs';
import { loadChatWithSettings } from '../../src/services/integrations/chatwith/chatwith-settings';
import { createTestBackgroundRouter } from './background-router-testkit';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('background-router chatwith open platform', () => {
  it('opens enabled platform in sender window', async () => {
    vi.mocked(loadChatWithSettings).mockResolvedValue({
      promptTemplate: '',
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    } as any);
    vi.mocked(tabsCreate).mockResolvedValue({ id: 99, windowId: 7, url: 'https://chatgpt.com/' } as any);

    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests(
      {
        type: 'chatwithOpenPlatformTab',
        platformId: 'chatgpt',
      },
      {
        tab: { id: 11, windowId: 7 },
      },
    );

    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ tabId: 99, windowId: 7, url: 'https://chatgpt.com/' });
    expect(tabsCreate).toHaveBeenCalledWith({
      url: 'https://chatgpt.com/',
      active: true,
      windowId: 7,
    });
  });

  it('rejects disabled platform and does not open tab', async () => {
    vi.mocked(loadChatWithSettings).mockResolvedValue({
      promptTemplate: '',
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: false }],
    } as any);

    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests({
      type: 'chatwithOpenPlatformTab',
      platformId: 'chatgpt',
      fallbackUrl: 'https://evil.example/',
    });

    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe('CHATWITH_PLATFORM_NOT_ENABLED');
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('requires valid platformId', async () => {
    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests({
      type: 'chatwithOpenPlatformTab',
      platformId: '   ',
      fallbackUrl: 'https://chatgpt.com/',
    });

    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe('CHATWITH_PLATFORM_ID_REQUIRED');
    expect(tabsCreate).not.toHaveBeenCalled();
  });
});
