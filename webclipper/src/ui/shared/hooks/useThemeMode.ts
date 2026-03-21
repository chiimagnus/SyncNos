import { useEffect } from 'react';

import { storageGet, storageOnChanged } from '../../../platform/storage/local';

import { normalizeThemeMode, THEME_MODE_STORAGE_KEY, type ThemeMode } from '../theme-mode';

export { THEME_MODE_STORAGE_KEY };
export type { ThemeMode };

export function applyThemeMode(mode: ThemeMode) {
  const root = globalThis.document?.documentElement;
  if (!root) return;

  if (mode === 'dark') {
    root.setAttribute('data-theme', 'dark');
    return;
  }

  if (mode === 'light') {
    root.setAttribute('data-theme', 'light');
    return;
  }

  root.removeAttribute('data-theme');
}

export function useThemeMode() {
  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const stored = await storageGet([THEME_MODE_STORAGE_KEY]);
        if (disposed) return;
        applyThemeMode(normalizeThemeMode(stored?.[THEME_MODE_STORAGE_KEY]));
      } catch (_e) {
        // ignore
      }
    })();

    const unsubscribe = storageOnChanged((changes, areaName) => {
      if (areaName !== 'local') return;
      const change = changes?.[THEME_MODE_STORAGE_KEY];
      if (!change) return;
      applyThemeMode(normalizeThemeMode(change?.newValue));
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
}
