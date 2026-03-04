export type SettingsSectionKey = 'notion' | 'obsidian' | 'backup' | 'inpage';

export const SETTINGS_SECTIONS: Array<{
  key: SettingsSectionKey;
  label: string;
  description: string;
}> = [
  { key: 'backup', label: 'Backup', description: 'Export/import your database.' },
  { key: 'notion', label: 'Notion', description: 'OAuth + parent page for sync.' },
  { key: 'obsidian', label: 'Obsidian', description: 'Local REST API settings + sync status.' },
  { key: 'inpage', label: 'Inpage', description: 'Inpage button visibility behavior.' },
];
