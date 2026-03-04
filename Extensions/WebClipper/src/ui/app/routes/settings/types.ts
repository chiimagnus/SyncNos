export type SettingsSectionKey = 'notion' | 'article' | 'obsidian' | 'backup' | 'inpage';

export const SETTINGS_SECTIONS: Array<{
  key: SettingsSectionKey;
  label: string;
  description: string;
}> = [
  { key: 'notion', label: 'Notion', description: 'OAuth + parent page for sync.' },
  { key: 'article', label: 'Article', description: 'Fetch current page into database.' },
  { key: 'obsidian', label: 'Obsidian', description: 'Local REST API settings + sync status.' },
  { key: 'backup', label: 'Backup', description: 'Export/import your database.' },
  { key: 'inpage', label: 'Inpage', description: 'Inpage button visibility behavior.' },
];
