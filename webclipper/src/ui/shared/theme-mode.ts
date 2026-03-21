export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODE_STORAGE_KEY = 'ui_theme_mode';

export function normalizeThemeMode(value: unknown): ThemeMode {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw as ThemeMode;
  return 'system';
}

