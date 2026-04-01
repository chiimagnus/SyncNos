import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_WITH_TAB_REUSE_STORAGE_KEY } from '../../src/services/integrations/chatwith/tabgroup-store';

type LocalStore = Record<string, unknown>;

let storageState: LocalStore = {};

const tabsCreateMock = vi.fn();
const tabsGetMock = vi.fn();
const tabsMoveMock = vi.fn();
const tabsUpdateMock = vi.fn();
const tabGroupsSupportedMock = vi.fn();
const tabsGroupMock = vi.fn();
const windowsUpdateMock = vi.fn();

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
    for (const key of keys || []) {
      delete storageState[key];
    }
  },
}));

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsCreate: (...args: any[]) => tabsCreateMock(...args),
  tabsGet: (...args: any[]) => tabsGetMock(...args),
  tabsMove: (...args: any[]) => tabsMoveMock(...args),
  tabsUpdate: (...args: any[]) => tabsUpdateMock(...args),
}));

vi.mock('../../src/platform/webext/tab-groups', () => ({
  tabGroupsSupported: (...args: any[]) => tabGroupsSupportedMock(...args),
  tabsGroup: (...args: any[]) => tabsGroupMock(...args),
}));

vi.mock('../../src/platform/webext/windows', () => ({
  windowsUpdate: (...args: any[]) => windowsUpdateMock(...args),
}));

describe('openOrFocusGroupedChatTab', () => {
  beforeEach(() => {
    storageState = {};
    vi.clearAllMocks();
    tabsCreateMock.mockResolvedValue({ id: 88, windowId: 7, url: 'https://chatgpt.com/' });
    tabsGetMock.mockResolvedValue(null);
    tabsMoveMock.mockResolvedValue([]);
    tabsUpdateMock.mockResolvedValue(null);
    tabGroupsSupportedMock.mockReturnValue(true);
    tabsGroupMock.mockResolvedValue(101);
    windowsUpdateMock.mockResolvedValue(null);
  });

  it('creates a new AI tab and groups with article tab on first run', async () => {
    tabsGetMock.mockImplementation(async (tabId: number) => {
      if (tabId === 17) return { id: 17, windowId: 7, groupId: -1, url: 'https://example.com/a' };
      return null;
    });

    const { openOrFocusGroupedChatTab } = await import('../../src/services/integrations/chatwith/tabgroup-runner');

    const result = await openOrFocusGroupedChatTab({
      platformId: 'chatgpt',
      articleKey: 'https://example.com/a',
      platformUrl: 'https://chatgpt.com/',
      articleTabId: 17,
    });

    expect(result).toMatchObject({
      tabId: 88,
      windowId: 7,
      reused: false,
      grouped: true,
      groupId: 101,
      degraded: false,
    });
    expect(tabsCreateMock).toHaveBeenCalledWith({
      url: 'https://chatgpt.com/',
      active: true,
      windowId: 7,
    });
    expect(tabsGroupMock).toHaveBeenCalledWith({
      tabIds: [17, 88],
      createProperties: { windowId: 7 },
    });

    const persisted = (storageState[CHAT_WITH_TAB_REUSE_STORAGE_KEY] || {}) as Record<string, any>;
    expect(persisted['chatgpt::https://example.com/a']?.aiTabId).toBe(88);
  });

  it('reuses stored AI tab and joins existing article group', async () => {
    storageState[CHAT_WITH_TAB_REUSE_STORAGE_KEY] = {
      'chatgpt::https://example.com/a': {
        aiTabId: 88,
        updatedAt: Date.now() - 5000,
      },
    };

    tabsGetMock.mockImplementation(async (tabId: number) => {
      if (tabId === 17) return { id: 17, windowId: 7, groupId: 3, url: 'https://example.com/a' };
      if (tabId === 88) return { id: 88, windowId: 7, groupId: -1, url: 'https://chatgpt.com/c/abc' };
      return null;
    });
    tabsGroupMock.mockResolvedValue(3);

    const { openOrFocusGroupedChatTab } = await import('../../src/services/integrations/chatwith/tabgroup-runner');

    const result = await openOrFocusGroupedChatTab({
      platformId: 'chatgpt',
      articleKey: 'https://example.com/a',
      platformUrl: 'https://chatgpt.com/',
      articleTabId: 17,
    });

    expect(result).toMatchObject({
      tabId: 88,
      reused: true,
      grouped: true,
      groupId: 3,
      degraded: false,
    });
    expect(tabsCreateMock).not.toHaveBeenCalled();
    expect(tabsGroupMock).toHaveBeenCalledWith({
      tabIds: [88],
      groupId: 3,
    });
  });

  it('recreates when cross-window move fails', async () => {
    storageState[CHAT_WITH_TAB_REUSE_STORAGE_KEY] = {
      'chatgpt::https://example.com/a': {
        aiTabId: 88,
        updatedAt: Date.now() - 5000,
      },
    };

    tabsGetMock.mockImplementation(async (tabId: number) => {
      if (tabId === 17) return { id: 17, windowId: 7, groupId: -1, url: 'https://example.com/a' };
      if (tabId === 88) return { id: 88, windowId: 5, groupId: -1, url: 'https://chatgpt.com/c/old' };
      return null;
    });
    tabsMoveMock.mockRejectedValue(new Error('move failed'));
    tabsCreateMock.mockResolvedValue({ id: 99, windowId: 7, url: 'https://chatgpt.com/' });
    tabsGroupMock.mockResolvedValue(55);

    const { openOrFocusGroupedChatTab } = await import('../../src/services/integrations/chatwith/tabgroup-runner');

    const result = await openOrFocusGroupedChatTab({
      platformId: 'chatgpt',
      articleKey: 'https://example.com/a',
      platformUrl: 'https://chatgpt.com/',
      articleTabId: 17,
    });

    expect(result).toMatchObject({
      tabId: 99,
      reused: false,
      grouped: true,
      groupId: 55,
      degraded: true,
      reason: 'recreate_after_move_failed',
    });
    expect(tabsCreateMock).toHaveBeenCalledWith({
      url: 'https://chatgpt.com/',
      active: true,
      windowId: 7,
    });

    const persisted = (storageState[CHAT_WITH_TAB_REUSE_STORAGE_KEY] || {}) as Record<string, any>;
    expect(persisted['chatgpt::https://example.com/a']?.aiTabId).toBe(99);
  });

  it('degrades gracefully when tabGroups API is unavailable', async () => {
    tabGroupsSupportedMock.mockReturnValue(false);
    tabsGetMock.mockImplementation(async (tabId: number) => {
      if (tabId === 17) return { id: 17, windowId: 7, groupId: -1, url: 'https://example.com/a' };
      return null;
    });

    const { openOrFocusGroupedChatTab } = await import('../../src/services/integrations/chatwith/tabgroup-runner');

    const result = await openOrFocusGroupedChatTab({
      platformId: 'chatgpt',
      articleKey: 'https://example.com/a',
      platformUrl: 'https://chatgpt.com/',
      articleTabId: 17,
    });

    expect(result.grouped).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe('tabgroups_unavailable');
    expect(tabsGroupMock).not.toHaveBeenCalled();
  });
});
