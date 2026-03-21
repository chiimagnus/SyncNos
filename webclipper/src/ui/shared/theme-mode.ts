import { storageGet, storageOnChanged } from '../../platform/storage/local';

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODE_STORAGE_KEY = 'ui_theme_mode';

export const THEME_ATTR = 'data-theme';
export const THEME_SOURCE_ATTR = 'data-webclipper-theme-source';
export const THEME_SOURCE_DOCUMENT = 'document';
export const THEME_SOURCE_STORAGE = 'storage';

export function normalizeThemeMode(value: unknown): ThemeMode {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw as ThemeMode;
  return 'system';
}

export function applyThemeModeToElement(el: HTMLElement, mode: ThemeMode) {
  if (!el) return;

  if (mode === 'dark') {
    el.setAttribute(THEME_ATTR, 'dark');
    return;
  }

  if (mode === 'light') {
    el.setAttribute(THEME_ATTR, 'light');
    return;
  }

  el.removeAttribute(THEME_ATTR);
}

export function watchThemeMode(onMode: (mode: ThemeMode) => void): () => void {
  if (typeof onMode !== 'function') return () => {};

  let disposed = false;

  void (async () => {
    try {
      const stored = await storageGet([THEME_MODE_STORAGE_KEY]);
      if (disposed) return;
      onMode(normalizeThemeMode(stored?.[THEME_MODE_STORAGE_KEY]));
    } catch (_e) {
      // ignore
    }
  })();

  const unsubscribe = storageOnChanged((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes?.[THEME_MODE_STORAGE_KEY];
    if (!change) return;
    onMode(normalizeThemeMode(change?.newValue));
  });

  return () => {
    disposed = true;
    unsubscribe();
  };
}
