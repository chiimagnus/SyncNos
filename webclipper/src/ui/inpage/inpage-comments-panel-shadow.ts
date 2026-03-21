import { mountThreadedCommentsPanel, type ThreadedCommentItem } from '../comments/threaded-comments-panel';
import type { CommentSidebarPanelApi } from '../../comments/sidebar/comment-sidebar-contract';
import { storageGet, storageOnChanged } from '../../platform/storage/local';
import { THEME_MODE_STORAGE_KEY, type ThemeMode, normalizeThemeMode } from '../shared/theme-mode';

export type InpageCommentItem = ThreadedCommentItem;
export type InpageCommentsPanelOpenInput = {
  focusComposer?: boolean;
};

export type InpageCommentsPanelApi = Omit<CommentSidebarPanelApi, 'open'> & {
  open: (input?: InpageCommentsPanelOpenInput) => void;
};

const PANEL_ID = 'webclipper-inpage-comments-panel';
const PANEL_THEME_SOURCE_ATTR = 'data-webclipper-theme-source';
const PANEL_THEME_SOURCE_STORAGE = 'storage';

let singleton: { el: HTMLElement; api: CommentSidebarPanelApi; cleanup?: () => void } | null = null;

function applyPanelThemeMode(el: HTMLElement, mode: ThemeMode) {
  try {
    el.setAttribute(PANEL_THEME_SOURCE_ATTR, PANEL_THEME_SOURCE_STORAGE);
  } catch (_e) {
    // ignore
  }

  if (mode === 'dark') {
    el.setAttribute('data-theme', 'dark');
    return;
  }

  if (mode === 'light') {
    el.setAttribute('data-theme', 'light');
    return;
  }

  // system
  try {
    el.removeAttribute('data-theme');
  } catch (_e) {
    // ignore
  }
}

function ensurePanelThemeSync(el: HTMLElement) {
  const anyEl = el as any;
  if (anyEl.__webclipperThemeReady === true) return;
  anyEl.__webclipperThemeReady = true;

  let disposed = false;

  void (async () => {
    try {
      const stored = await storageGet([THEME_MODE_STORAGE_KEY]);
      if (disposed) return;
      applyPanelThemeMode(el, normalizeThemeMode(stored?.[THEME_MODE_STORAGE_KEY]));
    } catch (_e) {
      // ignore
    }
  })();

  const unsubscribe = storageOnChanged((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes?.[THEME_MODE_STORAGE_KEY];
    if (!change) return;
    applyPanelThemeMode(el, normalizeThemeMode(change?.newValue));
  });

  anyEl.__webclipperThemeCleanup = () => {
    disposed = true;
    unsubscribe();
  };
}

function ensurePanel(): { el: HTMLElement; api: CommentSidebarPanelApi } {
  if (singleton && document.getElementById(PANEL_ID) !== singleton.el) {
    try {
      (singleton.el as any).__webclipperThemeCleanup?.();
    } catch (_e) {
      // ignore
    }
    try {
      singleton.cleanup?.();
    } catch (_e) {
      // ignore
    }
    singleton = null;
  }
  if (singleton && document.getElementById(PANEL_ID) === singleton.el) return singleton;

  const existing = document.getElementById(PANEL_ID) as HTMLElement | null;
  if (existing && (existing as any).__webclipperPanelApi) {
    ensurePanelThemeSync(existing);
    singleton = { el: existing, api: (existing as any).__webclipperPanelApi as CommentSidebarPanelApi };
    return singleton;
  }

  const host = document.documentElement;
  const mounted = mountThreadedCommentsPanel(host, {
    overlay: true,
    dockPage: true,
    initiallyOpen: false,
    variant: 'sidebar',
    showHeader: true,
    showCollapseButton: true,
  });
  const { el, api } = mounted;
  el.id = PANEL_ID;

  (el as any).__webclipperPanelApi = api;
  ensurePanelThemeSync(el);
  singleton = { el, api, cleanup: mounted.cleanup };
  return singleton;
}

const apiRef: InpageCommentsPanelApi = {
  open(input) {
    const { api } = ensurePanel();
    api.open({ focusComposer: input?.focusComposer === true });
  },
  close() {
    if (!singleton) return;
    singleton.api.close();
  },
  isOpen() {
    if (!singleton) return false;
    return singleton.api.isOpen();
  },
  setBusy(busy) {
    ensurePanel().api.setBusy(busy);
  },
  setQuoteText(text) {
    ensurePanel().api.setQuoteText(text);
  },
  setComments(items) {
    ensurePanel().api.setComments(items);
  },
  setHandlers(handlers) {
    ensurePanel().api.setHandlers(handlers as any);
  },
};

export function getInpageCommentsPanelApi(): InpageCommentsPanelApi {
  return apiRef;
}
