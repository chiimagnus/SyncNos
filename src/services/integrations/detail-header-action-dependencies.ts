import { DETAIL_HEADER_COPY_LINK_ACTION_STORAGE_KEY } from '@services/integrations/detail-header-copy-link-preference';
import { getSyncProviderEnabledStorageKeys } from '@services/sync/sync-provider-gate';
import { OBSIDIAN_STORAGE_KEYS } from '@services/sync/obsidian/settings-store';

export function getDetailHeaderActionStorageDependencyKeys(): string[] {
  return Array.from(
    new Set([
      ...getSyncProviderEnabledStorageKeys(),
      ...Object.values(OBSIDIAN_STORAGE_KEYS),
      DETAIL_HEADER_COPY_LINK_ACTION_STORAGE_KEY,
    ]),
  );
}

export function hasDetailHeaderActionStorageDependencyChange(changes: unknown, areaName: string): boolean {
  if (areaName !== 'local' || !changes || typeof changes !== 'object') return false;
  return getDetailHeaderActionStorageDependencyKeys().some((key) => Object.prototype.hasOwnProperty.call(changes, key));
}
