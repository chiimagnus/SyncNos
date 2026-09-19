import { DETAIL_HEADER_COPY_LINK_ACTION_STORAGE_KEY } from '@services/integrations/detail-header-copy-link-preference';
import { getSyncProviderEnabledStorageKeys } from '@services/sync/sync-provider-gate';
import { OBSIDIAN_STORAGE_KEYS } from '@services/sync/obsidian/settings-store';

const DETAIL_HEADER_ACTION_STORAGE_DEPENDENCY_KEYS = [
  ...getSyncProviderEnabledStorageKeys(),
  ...Object.values(OBSIDIAN_STORAGE_KEYS),
  DETAIL_HEADER_COPY_LINK_ACTION_STORAGE_KEY,
];

export function hasDetailHeaderActionStorageDependencyChange(changes: unknown, areaName: string): boolean {
  if (areaName !== 'local' || !changes || typeof changes !== 'object') return false;
  return DETAIL_HEADER_ACTION_STORAGE_DEPENDENCY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(changes, key));
}
