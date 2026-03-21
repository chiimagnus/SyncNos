import { mountThreadedCommentsPanel, type ThreadedCommentItem } from '../comments/threaded-comments-panel';
import type { CommentSidebarPanelApi } from '../../comments/sidebar/comment-sidebar-contract';
import { registerInpageThemeTarget } from './inpage-theme';

export type InpageCommentItem = ThreadedCommentItem;
export type InpageCommentsPanelOpenInput = {
  focusComposer?: boolean;
};

export type InpageCommentsPanelApi = Omit<CommentSidebarPanelApi, 'open'> & {
  open: (input?: InpageCommentsPanelOpenInput) => void;
};

const PANEL_ID = 'webclipper-inpage-comments-panel';

let singleton: { el: HTMLElement; api: CommentSidebarPanelApi; cleanup?: () => void } | null = null;

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
    if (!(existing as any).__webclipperThemeCleanup) {
      (existing as any).__webclipperThemeCleanup = registerInpageThemeTarget(existing, { markSource: true });
    }
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
  (el as any).__webclipperThemeCleanup = registerInpageThemeTarget(el, { markSource: true });
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
