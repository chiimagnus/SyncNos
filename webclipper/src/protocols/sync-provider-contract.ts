import type { SyncProvider } from '../sync/models';

export type SyncProviderId = SyncProvider;

export type SyncProviderDefinition = {
  id: SyncProviderId;
  labelKey: string;
  settingsSectionKey: string;
};

