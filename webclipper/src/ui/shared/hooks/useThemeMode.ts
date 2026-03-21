import { useEffect } from 'react';

import { applyThemeModeToElement, watchThemeMode } from '../theme-mode';

import { THEME_MODE_STORAGE_KEY, type ThemeMode } from '../theme-mode';

export { THEME_MODE_STORAGE_KEY };
export type { ThemeMode };

export function applyThemeMode(mode: ThemeMode) {
  const root = globalThis.document?.documentElement as any as HTMLElement | null;
  if (!root) return;
  applyThemeModeToElement(root, mode);
}

export function useThemeMode() {
  useEffect(() => {
    return watchThemeMode(applyThemeMode);
  }, []);
}
