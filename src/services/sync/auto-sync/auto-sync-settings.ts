import { storageGet, storageSet } from '@platform/storage/local';
import type { SyncProvider } from '@services/sync/models';
import {
  FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
  GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
  NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY,
  OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
} from '@services/sync/auto-sync/auto-sync-keys';

const AUTO_SYNC_STORAGE_KEY_BY_PROVIDER: Record<SyncProvider, string> = {
  notion: NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY,
  obsidian: OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
  feishu: FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
  github: GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
};

export function autoSyncEnabledStorageKey(provider: SyncProvider): string {
  return AUTO_SYNC_STORAGE_KEY_BY_PROVIDER[provider];
}

export async function isAutoSyncEnabled(provider: SyncProvider): Promise<boolean> {
  const key = autoSyncEnabledStorageKey(provider);
  const local = await storageGet([key]);
  return local?.[key] === true;
}

export async function setAutoSyncEnabled(provider: SyncProvider, enabled: boolean): Promise<void> {
  await storageSet({ [autoSyncEnabledStorageKey(provider)]: enabled === true });
}
