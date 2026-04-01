import { beforeEach, describe, expect, it, vi } from 'vitest';

const webextState = vi.hoisted(() => ({
  apis: {
    chrome: undefined as any,
    browser: undefined as any,
  },
}));

vi.mock('../../src/platform/webext/base', () => ({
  webextApis: () => webextState.apis,
  webextError: (message: unknown) => new Error(String(message || 'unknown error')),
  webextLastErrorMessage: (fallback: string) => {
    const message = webextState.apis.chrome?.runtime?.lastError?.message;
    return String(message || fallback || 'runtime error');
  },
}));

describe('platform/webext tab groups wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webextState.apis.chrome = undefined;
    webextState.apis.browser = undefined;
  });

  it('detects tabGroups support from browser API', async () => {
    const groupMock = vi.fn(async () => 9);
    webextState.apis.browser = {
      tabs: {
        group: groupMock,
      },
    };

    const { tabGroupsSupported } = await import('../../src/platform/webext/tab-groups');

    expect(tabGroupsSupported()).toBe(true);
  });

  it('groups tabs using browser API', async () => {
    const groupMock = vi.fn(async () => 11);
    webextState.apis.browser = {
      tabs: {
        group: groupMock,
      },
    };

    const { tabsGroup } = await import('../../src/platform/webext/tab-groups');

    const groupId = await tabsGroup({
      tabIds: [2, 3],
      createProperties: { windowId: 7 },
    });

    expect(groupId).toBe(11);
    expect(groupMock).toHaveBeenCalledWith({
      tabIds: [2, 3],
      createProperties: { windowId: 7 },
    });
  });

  it('groups tabs using chrome callback API', async () => {
    const groupMock = vi.fn((_: any, callback: (groupId: number) => void) => callback(13));
    webextState.apis.chrome = {
      tabs: {
        group: groupMock,
      },
      runtime: {},
    };

    const { tabsGroup } = await import('../../src/platform/webext/tab-groups');

    const groupId = await tabsGroup({
      tabIds: [5],
      groupId: 3,
    });

    expect(groupId).toBe(13);
    expect(groupMock).toHaveBeenCalledWith(
      {
        tabIds: [5],
        groupId: 3,
      },
      expect.any(Function),
    );
  });

  it('throws when grouping is unavailable', async () => {
    const { tabsGroup, tabGroupsSupported } = await import('../../src/platform/webext/tab-groups');

    expect(tabGroupsSupported()).toBe(false);
    await expect(tabsGroup({ tabIds: [1] })).rejects.toThrow('tabs.group unavailable');
  });

  it('ungroups via chrome API and surfaces runtime errors', async () => {
    const ungroupMock = vi.fn((_: number[], callback: () => void) => {
      webextState.apis.chrome.runtime.lastError = { message: 'permission denied' };
      callback();
      webextState.apis.chrome.runtime.lastError = undefined;
    });
    webextState.apis.chrome = {
      tabs: {
        ungroup: ungroupMock,
      },
      runtime: {},
    };

    const { tabsUngroup } = await import('../../src/platform/webext/tab-groups');

    await expect(tabsUngroup([8])).rejects.toThrow('permission denied');
  });
});

describe('platform/webext tabs move wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webextState.apis.chrome = undefined;
    webextState.apis.browser = undefined;
  });

  it('moves tabs with browser API and normalizes singleton result', async () => {
    const moveMock = vi.fn(async () => ({ id: 42, windowId: 6 }));
    webextState.apis.browser = {
      tabs: {
        move: moveMock,
      },
    };

    const { tabsMove } = await import('../../src/platform/webext/tabs');

    const moved = await tabsMove(42, { windowId: 6, index: -1 });

    expect(moved).toEqual([{ id: 42, windowId: 6 }]);
    expect(moveMock).toHaveBeenCalledWith(42, { windowId: 6, index: -1 });
  });

  it('returns empty array for invalid tab ids', async () => {
    const { tabsMove } = await import('../../src/platform/webext/tabs');

    const moved = await tabsMove([], { index: -1 });

    expect(moved).toEqual([]);
  });
});
