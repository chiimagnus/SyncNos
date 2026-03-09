import { describe, expect, it } from 'vitest';

import { SETTINGS_SECTION_GROUPS, SETTINGS_SECTIONS } from '../../src/ui/settings/types';

describe('settings section definitions', () => {
  it('keeps the flattened settings navigation order stable', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.key)).toEqual([
      'backup',
      'notion',
      'obsidian',
      'chat_with',
      'insight',
      'inpage',
      'about',
    ]);
  });

  it('groups sections into integrations, behavior, and about areas', () => {
    expect(
      SETTINGS_SECTION_GROUPS.map((group) => ({
        title: group.title,
        keys: group.sections.map((section) => section.key),
      }))
    ).toEqual([
      { title: 'Data', keys: ['backup', 'notion', 'obsidian'] },
      { title: 'Features', keys: ['chat_with', 'insight', 'inpage'] },
      { title: 'About', keys: ['about'] },
    ]);
  });
});
