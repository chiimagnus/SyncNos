import { beforeEach, describe, expect, it, vi } from 'vitest';

type Store = Record<string, unknown>;

let store: Store;
let getError: Error | null;
let removeError: Error | null;

vi.mock('@platform/storage/local', () => {
  return {
    storageGet: async (keys: string[]) => {
      if (getError) throw getError;
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        out[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      }
      return out;
    },
    storageSet: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items || {})) store[k] = v;
    },
    storageRemove: async (keys: string[]) => {
      if (removeError) throw removeError;
      for (const key of keys || []) delete store[key];
    },
  };
});

describe('sync provider gate', () => {
  beforeEach(() => {
    store = {};
    getError = null;
    removeError = null;
  });

  it('owns the stable provider gate storage dependency set', async () => {
    const { getSyncProviderEnabledStorageKeys, hasSyncProviderEnabledStorageChange } =
      await import('@services/sync/sync-provider-gate');
    expect(getSyncProviderEnabledStorageKeys()).toEqual([
      'webclipper_sync_provider_obsidian_enabled',
      'webclipper_sync_provider_notion_enabled',
      'webclipper_sync_provider_feishu_enabled',
      'webclipper_sync_provider_github_enabled',
    ]);
    expect(
      hasSyncProviderEnabledStorageChange({ webclipper_sync_provider_github_enabled: { newValue: false } }, 'local'),
    ).toBe(true);
    expect(
      hasSyncProviderEnabledStorageChange({ webclipper_sync_provider_github_enabled: { newValue: false } }, 'sync'),
    ).toBe(false);
    expect(hasSyncProviderEnabledStorageChange({ unrelated: { newValue: false } }, 'local')).toBe(false);
  });

  it('defaults to enabled when key is missing', async () => {
    const { getEnabledSyncProviders, isSyncProviderEnabled } = await import('@services/sync/sync-provider-gate');
    expect(await isSyncProviderEnabled('notion')).toBe(true);
    expect(await isSyncProviderEnabled('obsidian')).toBe(true);
    expect(await isSyncProviderEnabled('feishu')).toBe(true);
    expect(await isSyncProviderEnabled('github')).toBe(true);
    expect(await getEnabledSyncProviders()).toEqual(['obsidian', 'notion', 'feishu', 'github']);
  });

  it('propagates storage failures instead of treating them as enabled or successfully persisted', async () => {
    const { isSyncProviderEnabled, setSyncProviderEnabled } = await import('@services/sync/sync-provider-gate');
    getError = new Error('storage read failed');
    await expect(isSyncProviderEnabled('notion')).rejects.toThrow('storage read failed');

    getError = null;
    removeError = new Error('storage remove failed');
    await expect(setSyncProviderEnabled('notion', true)).rejects.toThrow('storage remove failed');
  });

  it('reads/writes disabled state via storage (explicit false only)', async () => {
    const { ensureSyncProviderEnabled, getEnabledSyncProviders, isSyncProviderEnabled, setSyncProviderEnabled } =
      await import('@services/sync/sync-provider-gate');
    expect(await ensureSyncProviderEnabled('notion')).toBe(null);

    await setSyncProviderEnabled('notion', false);
    expect(await isSyncProviderEnabled('notion')).toBe(false);
    expect(await ensureSyncProviderEnabled('notion')).toEqual({ code: 'sync_provider_disabled', provider: 'notion' });

    await setSyncProviderEnabled('notion', true);
    expect(await isSyncProviderEnabled('notion')).toBe(true);
    expect(await ensureSyncProviderEnabled('notion')).toBe(null);

    await setSyncProviderEnabled('feishu', false);
    expect(await isSyncProviderEnabled('feishu')).toBe(false);
    expect(await ensureSyncProviderEnabled('feishu')).toEqual({ code: 'sync_provider_disabled', provider: 'feishu' });

    await setSyncProviderEnabled('github', false);
    expect(await isSyncProviderEnabled('github')).toBe(false);
    expect(await ensureSyncProviderEnabled('github')).toEqual({ code: 'sync_provider_disabled', provider: 'github' });
    expect(await getEnabledSyncProviders()).toEqual(['obsidian', 'notion']);
  });
});
