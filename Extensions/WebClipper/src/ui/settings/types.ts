export type SettingsSectionKey = 'notion' | 'obsidian' | 'backup' | 'article' | 'inpage' | 'about';

export const SETTINGS_SECTIONS: Array<{
  key: SettingsSectionKey;
  label: string;
  description: string;
}> = [
  { key: 'backup', label: 'Backup', description: 'Export/import your database.' },
  { key: 'notion', label: 'Notion', description: 'OAuth + parent page for sync.' },
  { key: 'obsidian', label: 'Obsidian', description: 'Local REST API settings + sync status.' },
  { key: 'article', label: 'Article', description: 'Fetch current page article into your database.' },
  { key: 'inpage', label: 'Inpage', description: 'Inpage button visibility behavior.' },
  { key: 'about', label: 'About', description: 'Project, author, and support links.' },
];
