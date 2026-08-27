import { describe, expect, it } from 'vitest';

import { getSyncProviderDefinition, listSyncProviders } from '@services/sync/sync-provider-registry';

describe('sync provider registry', () => {
  it('lists all production sync providers in stable menu order', () => {
    expect(listSyncProviders()).toEqual([
      { id: 'obsidian', labelKey: 'providerObsidian', settingsSectionKey: 'obsidian' },
      { id: 'notion', labelKey: 'providerNotion', settingsSectionKey: 'notion' },
      { id: 'feishu', labelKey: 'providerFeishu', settingsSectionKey: 'feishu' },
      { id: 'github', labelKey: 'providerGithub', settingsSectionKey: 'github' },
    ]);
  });

  it('resolves the GitHub production definition without a fallback provider', () => {
    expect(getSyncProviderDefinition('github')).toEqual({
      id: 'github',
      labelKey: 'providerGithub',
      settingsSectionKey: 'github',
    });
  });
});
