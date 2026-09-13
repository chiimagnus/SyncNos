import { beforeEach, describe, expect, it, vi } from 'vitest';

let store: Record<string, unknown> = {};

vi.mock('@platform/storage/local', () => ({
  storageGet: async (keys: string[]) => Object.fromEntries((keys || []).map((key) => [key, store[key]])),
  storageSet: async (patch: Record<string, unknown>) => {
    Object.assign(store, patch || {});
  },
}));

import {
  autoSyncEnabledStorageKey,
  isAutoSyncEnabled,
  setAutoSyncEnabled,
} from '@services/sync/auto-sync/auto-sync-settings';

describe('auto-sync settings', () => {
  beforeEach(() => {
    store = {};
  });

  it('owns the four provider storage-key mappings', () => {
    expect(autoSyncEnabledStorageKey('notion')).toBe('notion_auto_sync_enabled_v1');
    expect(autoSyncEnabledStorageKey('obsidian')).toBe('obsidian_auto_sync_enabled_v1');
    expect(autoSyncEnabledStorageKey('feishu')).toBe('feishu_auto_sync_enabled_v1');
    expect(autoSyncEnabledStorageKey('github')).toBe('github_auto_sync_enabled_v1');
  });

  it('defaults false and persists explicit booleans', async () => {
    expect(await isAutoSyncEnabled('notion')).toBe(false);
    await setAutoSyncEnabled('notion', true);
    expect(await isAutoSyncEnabled('notion')).toBe(true);
    await setAutoSyncEnabled('notion', false);
    expect(await isAutoSyncEnabled('notion')).toBe(false);
    expect(store.notion_auto_sync_enabled_v1).toBe(false);
  });
});
