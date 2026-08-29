import { storageGet, storageRemove, storageSet } from '@platform/storage/local';
import type { SyncProvider } from '@services/sync/models';
import { listSyncProviders } from '@services/sync/sync-provider-registry';

export type SyncProviderGateDisabledExtra = {
  code: 'sync_provider_disabled';
  provider: SyncProvider;
};

export function syncProviderEnabledStorageKey(id: SyncProvider): string {
  return `webclipper_sync_provider_${id}_enabled`;
}

export function getSyncProviderEnabledStorageKeys(): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const provider of listSyncProviders()) {
    const key = syncProviderEnabledStorageKey(provider.id);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function hasSyncProviderEnabledStorageChange(changes: unknown, areaName: string): boolean {
  if (areaName !== 'local' || !changes || typeof changes !== 'object') return false;
  return getSyncProviderEnabledStorageKeys().some((key) => Object.prototype.hasOwnProperty.call(changes, key));
}

export async function isSyncProviderEnabled(id: SyncProvider): Promise<boolean> {
  const key = syncProviderEnabledStorageKey(id);
  const res = await storageGet([key]).catch(() => ({}));
  return (res as any)?.[key] !== false;
}

export async function setSyncProviderEnabled(id: SyncProvider, enabled: boolean): Promise<void> {
  const key = syncProviderEnabledStorageKey(id);
  if (enabled) {
    await storageRemove([key]).catch(() => {});
    return;
  }
  await storageSet({ [key]: false });
}

export async function getEnabledSyncProviders(): Promise<SyncProvider[]> {
  const providers = listSyncProviders();
  const res = await storageGet(getSyncProviderEnabledStorageKeys());
  const out: SyncProvider[] = [];
  for (const p of providers) {
    const key = syncProviderEnabledStorageKey(p.id);
    if ((res as any)?.[key] !== false) out.push(p.id);
  }
  return out;
}

export async function ensureSyncProviderEnabled(id: SyncProvider): Promise<SyncProviderGateDisabledExtra | null> {
  const enabled = await isSyncProviderEnabled(id);
  if (enabled) return null;
  return { code: 'sync_provider_disabled', provider: id };
}
