import type { SyncProvider } from '@services/sync/models';

export type SyncProviderDefinition = {
  id: SyncProvider;
  labelKey: string;
  settingsSectionKey: string;
};

const REGISTRY: ReadonlyArray<SyncProviderDefinition> = [
  { id: 'obsidian', labelKey: 'providerObsidian', settingsSectionKey: 'obsidian' },
  { id: 'notion', labelKey: 'providerNotion', settingsSectionKey: 'notion' },
  { id: 'feishu', labelKey: 'providerFeishu', settingsSectionKey: 'feishu' },
  { id: 'github', labelKey: 'providerGithub', settingsSectionKey: 'github' },
] as const;

export function listSyncProviders(): SyncProviderDefinition[] {
  return REGISTRY.slice();
}

export function getSyncProviderDefinition(id: SyncProvider): SyncProviderDefinition | null {
  return REGISTRY.find((provider) => provider.id === id) ?? null;
}
