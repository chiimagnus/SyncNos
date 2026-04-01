import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let storageState: Record<string, unknown> = {};

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsCreate: vi.fn(),
  tabsQuery: vi.fn(),
  tabsGet: vi.fn(),
  tabsUpdate: vi.fn(),
  tabsMove: vi.fn(),
  tabsSendMessage: vi.fn(),
  tabsRemove: vi.fn(),
}));

vi.mock('../../src/platform/webext/tab-groups', () => ({
  tabGroupsSupported: vi.fn(),
  tabsGroup: vi.fn(),
  tabsUngroup: vi.fn(),
}));

vi.mock('../../src/platform/webext/windows', () => ({
  windowsUpdate: vi.fn(),
}));

vi.mock('../../src/platform/storage/local', () => ({
  storageGet: async (keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const key of keys || []) {
      out[key] = Object.prototype.hasOwnProperty.call(storageState, key) ? storageState[key] : null;
    }
    return out;
  },
  storageSet: async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items || {})) {
      storageState[key] = value;
    }
  },
  storageRemove: async (keys: string[]) => {
    for (const key of keys || []) delete storageState[key];
  },
  storageOnChanged: () => () => {},
}));

vi.mock('../../src/services/integrations/chatwith/chatwith-settings', async () => {
  const actual = await vi.importActual('../../src/services/integrations/chatwith/chatwith-settings');
  return {
    ...(actual as Record<string, unknown>),
    loadChatWithSettings: vi.fn(),
  };
});

import { tabsCreate, tabsGet } from '../../src/platform/webext/tabs';
import { tabGroupsSupported, tabsGroup } from '../../src/platform/webext/tab-groups';
import { loadChatWithSettings } from '../../src/services/integrations/chatwith/chatwith-settings';
import { createTestBackgroundRouter } from './background-router-testkit';

beforeEach(() => {
  storageState = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('background-router chatwith grouped tab open/focus', () => {
  it('creates grouped platform tab in sender window', async () => {
    vi.mocked(loadChatWithSettings).mockResolvedValue({
      promptTemplate: '',
      maxChars: 28000,
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    } as any);
    vi.mocked(tabGroupsSupported).mockReturnValue(true);
    vi.mocked(tabsGet).mockImplementation(async (tabId: number) => {
      if (tabId === 17) return { id: 17, windowId: 7, groupId: -1, url: 'https://example.com/article' } as any;
      return null as any;
    });
    vi.mocked(tabsCreate).mockResolvedValue({ id: 99, windowId: 7, url: 'https://chatgpt.com/' } as any);
    vi.mocked(tabsGroup).mockResolvedValue(42 as any);

    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests(
      {
        type: 'chatwithOpenOrFocusGroupedChatTab',
        platformId: 'chatgpt',
        articleKey: 'https://example.com/article',
      },
      {
        tab: { id: 17, windowId: 7 },
      },
    );

    expect(res.ok).toBe(true);
    expect(res.data).toEqual(
      expect.objectContaining({
        tabId: 99,
        grouped: true,
        groupId: 42,
        reused: false,
      }),
    );
    expect(tabsCreate).toHaveBeenCalledWith({
      url: 'https://chatgpt.com/',
      active: true,
      windowId: 7,
    });
  });

  it('degrades gracefully when article tab context is unavailable', async () => {
    vi.mocked(loadChatWithSettings).mockResolvedValue({
      promptTemplate: '',
      maxChars: 28000,
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    } as any);
    vi.mocked(tabGroupsSupported).mockReturnValue(true);
    vi.mocked(tabsCreate).mockResolvedValue({ id: 101, windowId: 9, url: 'https://chatgpt.com/' } as any);

    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests({
      type: 'chatwithOpenOrFocusGroupedChatTab',
      platformId: 'chatgpt',
      articleKey: 'https://example.com/article',
    });

    expect(res.ok).toBe(true);
    expect(res.data).toEqual(
      expect.objectContaining({
        tabId: 101,
        grouped: false,
        degraded: true,
        reason: 'article_tab_unavailable',
      }),
    );
    expect(tabsGroup).not.toHaveBeenCalled();
  });

  it('requires article key for grouped open/focus', async () => {
    vi.mocked(loadChatWithSettings).mockResolvedValue({
      promptTemplate: '',
      maxChars: 28000,
      platforms: [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true }],
    } as any);

    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests({
      type: 'chatwithOpenOrFocusGroupedChatTab',
      platformId: 'chatgpt',
      articleKey: '   ',
    });

    expect(res.ok).toBe(false);
    expect(res.error?.extra?.code).toBe('CHATWITH_ARTICLE_KEY_REQUIRED');
  });
});
