export type SettingsSectionKey =
  | 'backup'
  | 'notion'
  | 'chat_with'
  | 'aboutyou'
  | 'obsidian'
  | 'general'
  | 'aboutme';

export type SettingsSectionGroup = {
  title: string;
  sections: ReadonlyArray<{ key: SettingsSectionKey }>;
};

export const SETTINGS_SECTION_GROUPS: ReadonlyArray<SettingsSectionGroup> = [
  {
    title: 'Features',
    sections: [{ key: 'general' }, { key: 'chat_with' }],
  },
  {
    title: 'Data',
    sections: [{ key: 'backup' }, { key: 'notion' }, { key: 'obsidian' }],
  },
  {
    title: 'About',
    sections: [{ key: 'aboutyou' }, { key: 'aboutme' }],
  },
];

export const SETTINGS_SECTIONS: ReadonlyArray<{ key: SettingsSectionKey }> = SETTINGS_SECTION_GROUPS.flatMap(
  (group) => group.sections,
);

export const DEFAULT_SETTINGS_SECTION_KEY: SettingsSectionKey = SETTINGS_SECTIONS[0]?.key ?? 'backup';

export const SETTINGS_ACTIVE_SECTION_STORAGE_KEY = 'webclipper_settings_active_section';

export function isSettingsSectionKey(value: string): value is SettingsSectionKey {
  return SETTINGS_SECTIONS.some((section) => section.key === value);
}

export function coerceSettingsSectionKey(value: string): SettingsSectionKey | null {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (isSettingsSectionKey(raw)) return raw;

  // Backward compat for older deep links/stored values.
  if (raw === 'insight') return 'aboutyou';
  if (raw === 'about') return 'aboutme';

  return null;
}

export function readStoredSettingsSection(): SettingsSectionKey {
  try {
    const value = String(globalThis.localStorage?.getItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY) || '')
      .trim()
      .toLowerCase();
    const coerced = coerceSettingsSectionKey(value);
    if (coerced) return coerced;
  } catch (_e) {
    // ignore
  }
  return DEFAULT_SETTINGS_SECTION_KEY;
}

export function writeStoredSettingsSection(value: SettingsSectionKey) {
  try {
    globalThis.localStorage?.setItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY, value);
  } catch (_e) {
    // ignore
  }
}
