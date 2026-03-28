import { describe, expect, it } from 'vitest';

import { SETTINGS_SECTION_GROUPS, SETTINGS_SECTIONS } from '../../src/viewmodels/settings/types';

describe('settings section definitions', () => {
  it('keeps the flattened settings navigation order stable', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.key)).toEqual([
      'general',
      'chat_with',
      'backup',
      'notion',
      'obsidian',
      'aboutyou',
      'aboutme',
    ]);
  });

  it('groups sections into integrations, behavior, and about areas', () => {
    expect(
      SETTINGS_SECTION_GROUPS.map((group) => ({
        titleKey: group.titleKey,
        keys: group.sections.map((section) => section.key),
      })),
    ).toEqual([
      { titleKey: 'settingsGroupFeatures', keys: ['general', 'chat_with'] },
      { titleKey: 'settingsGroupData', keys: ['backup', 'notion', 'obsidian'] },
      { titleKey: 'settingsGroupAbout', keys: ['aboutyou', 'aboutme'] },
    ]);
  });
});
