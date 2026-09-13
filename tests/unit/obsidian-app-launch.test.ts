import { beforeEach, describe, expect, it, vi } from 'vitest';

const tabsCreate = vi.hoisted(() => vi.fn());

vi.mock('@platform/webext/tabs', () => ({ tabsCreate }));

import { launchObsidianApp } from '@services/sync/obsidian/obsidian-app-launch';

describe('launchObsidianApp', () => {
  beforeEach(() => {
    tabsCreate.mockReset();
  });

  it('reports success only when tabs.create actually opens the protocol URL in a non-DOM runtime', async () => {
    tabsCreate.mockResolvedValue({ id: 1 });
    await expect(launchObsidianApp()).resolves.toBe(true);
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'obsidian://open', active: true });
  });

  it('reports failure when tabs.create rejects instead of treating a missing window as success', async () => {
    tabsCreate.mockRejectedValue(new Error('custom protocol rejected'));
    await expect(launchObsidianApp()).resolves.toBe(false);
  });
});
