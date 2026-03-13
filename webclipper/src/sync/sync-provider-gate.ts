import { storageGet, storageRemove, storageSet } from '../platform/storage/local';
import type { SyncProviderId } from '../protocols/sync-provider-contract';
import { listSyncProviders } from './sync-provider-registry';

export type SyncProviderGateDisabledExtra = {
  code: 'sync_provider_disabled';
  provider: SyncProviderId;
};

export function syncProviderEnabledStorageKey(id: SyncProviderId): string {
  return `webclipper_sync_provider_${id}_enabled`;
}

export async function isSyncProviderEnabled(id: SyncProviderId): Promise<boolean> {
  const key = syncProviderEnabledStorageKey(id);
  const res = await storageGet([key]).catch(() => ({}));
  return (res as any)?.[key] !== false;
}

export async function setSyncProviderEnabled(id: SyncProviderId, enabled: boolean): Promise<void> {
  const key = syncProviderEnabledStorageKey(id);
  if (enabled) {
    await storageRemove([key]).catch(() => {});
    return;
  }
  await storageSet({ [key]: false });
}

export async function getEnabledSyncProviders(): Promise<SyncProviderId[]> {
  const providers = listSyncProviders();
  const keys = providers.map((p) => syncProviderEnabledStorageKey(p.id));
  const res = await storageGet(keys).catch(() => ({}));
  const out: SyncProviderId[] = [];
  for (const p of providers) {
    const key = syncProviderEnabledStorageKey(p.id);
    if ((res as any)?.[key] !== false) out.push(p.id);
  }
  return out;
}

export async function ensureSyncProviderEnabled(id: SyncProviderId): Promise<SyncProviderGateDisabledExtra | null> {
  const enabled = await isSyncProviderEnabled(id);
  if (enabled) return null;
  return { code: 'sync_provider_disabled', provider: id };
}

