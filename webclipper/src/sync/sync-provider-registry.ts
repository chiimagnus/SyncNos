import type { SyncProviderId, SyncProviderDefinition } from '@services/protocols/sync-provider-contract';

const REGISTRY: ReadonlyArray<SyncProviderDefinition> = [
  { id: 'obsidian', labelKey: 'providerObsidian', settingsSectionKey: 'obsidian' },
  { id: 'notion', labelKey: 'providerNotion', settingsSectionKey: 'notion' },
] as const;

export function listSyncProviders(): SyncProviderDefinition[] {
  return REGISTRY.slice();
}

export function getSyncProviderDefinition(id: SyncProviderId): SyncProviderDefinition | null {
  return REGISTRY.find((provider) => provider.id === id) ?? null;
}
