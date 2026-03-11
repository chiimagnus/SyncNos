import { useEffect } from 'react';

import { storageGet, storageOnChanged } from '../../../platform/storage/local';

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODE_STORAGE_KEY = 'ui_theme_mode';

function normalizeThemeMode(value: unknown): ThemeMode {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw as ThemeMode;
  return 'system';
}

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

