import { beforeEach, describe, expect, it, vi } from 'vitest';

type Store = Record<string, unknown>;

let store: Store;

vi.mock('../../src/platform/storage/local', () => {
  return {
    storageGet: async (keys: string[]) => {
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
      for (const key of keys || []) delete store[key];
    },
  };
});

describe('sync provider gate', () => {
  beforeEach(() => {
    store = {};
  });

  it('defaults to enabled when key is missing', async () => {
    const { getEnabledSyncProviders, isSyncProviderEnabled } = await import('../../src/sync/sync-provider-gate');
    expect(await isSyncProviderEnabled('notion')).toBe(true);
    expect(await isSyncProviderEnabled('obsidian')).toBe(true);
    expect(await getEnabledSyncProviders()).toEqual(['obsidian', 'notion']);
  });

  it('reads/writes disabled state via storage (explicit false only)', async () => {
    const { ensureSyncProviderEnabled, isSyncProviderEnabled, setSyncProviderEnabled } = await import('../../src/sync/sync-provider-gate');
    expect(await ensureSyncProviderEnabled('notion')).toBe(null);

    await setSyncProviderEnabled('notion', false);
    expect(await isSyncProviderEnabled('notion')).toBe(false);
    expect(await ensureSyncProviderEnabled('notion')).toEqual({ code: 'sync_provider_disabled', provider: 'notion' });

    await setSyncProviderEnabled('notion', true);
    expect(await isSyncProviderEnabled('notion')).toBe(true);
    expect(await ensureSyncProviderEnabled('notion')).toBe(null);
  });
});

