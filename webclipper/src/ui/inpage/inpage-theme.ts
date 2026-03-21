import {
  applyThemeModeToElement,
  THEME_SOURCE_ATTR,
  THEME_SOURCE_STORAGE,
  type ThemeMode,
  watchThemeMode,
} from '../shared/theme-mode';

type ThemeTarget = {
  el: HTMLElement;
  markSource: boolean;
};

const state = {
  mode: 'system' as ThemeMode,
  targets: new Map<HTMLElement, ThemeTarget>(),
  unsubscribe: null as null | (() => void),
};

function applyToTarget(target: ThemeTarget) {
  if (!target?.el) return;
  if (!(target.el as any).isConnected) return;

  if (target.markSource) {
    try {
      target.el.setAttribute(THEME_SOURCE_ATTR, THEME_SOURCE_STORAGE);
    } catch (_e) {
      // ignore
    }
  }

  applyThemeModeToElement(target.el, state.mode);
}

function ensureSubscription() {
  if (state.unsubscribe) return;
  state.unsubscribe = watchThemeMode((mode) => {
    state.mode = mode;
    for (const target of state.targets.values()) applyToTarget(target);
  });
}

export function registerInpageThemeTarget(el: HTMLElement, options?: { markSource?: boolean }): () => void {
  if (!el) return () => {};

  ensureSubscription();
  const target: ThemeTarget = { el, markSource: options?.markSource !== false };
  state.targets.set(el, target);
  applyToTarget(target);

  return () => {
    state.targets.delete(el);
    if (state.targets.size) return;
    try {
      state.unsubscribe?.();
    } finally {
      state.unsubscribe = null;
      state.mode = 'system';
    }
  };
}

