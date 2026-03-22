import type { SyncProvider } from '@services/sync/models';

export type SyncProviderId = SyncProvider;

export type SyncProviderDefinition = {
  id: SyncProviderId;
  labelKey: string;
  settingsSectionKey: string;
};
