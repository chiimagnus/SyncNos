export type SettingsSectionKey = 'notion' | 'obsidian' | 'backup' | 'inpage' | 'about';

export const SETTINGS_SECTIONS: Array<{
  key: SettingsSectionKey;
  label: string;
  description: string;
}> = [
  { key: 'backup', label: 'Backup', description: 'Export/import your database.' },
  { key: 'notion', label: 'Notion', description: 'OAuth + parent page for sync.' },
  { key: 'obsidian', label: 'Obsidian', description: 'Local REST API settings + sync status.' },
  { key: 'inpage', label: 'Inpage', description: 'Inpage button visibility behavior.' },
  { key: 'about', label: 'About', description: 'Project, author, and support links.' },
];

export const DEFAULT_SETTINGS_SECTION_KEY: SettingsSectionKey = SETTINGS_SECTIONS[0]?.key ?? 'backup';

export const SETTINGS_ACTIVE_SECTION_STORAGE_KEY = 'webclipper_settings_active_section';

export function isSettingsSectionKey(value: string): value is SettingsSectionKey {
  return SETTINGS_SECTIONS.some((section) => section.key === value);
}

export function readStoredSettingsSection(): SettingsSectionKey {
  try {
    const value = String(globalThis.localStorage?.getItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY) || '').trim().toLowerCase();
    if (isSettingsSectionKey(value)) return value;
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
