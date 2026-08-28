import { mountThreadedCommentsPanel } from '@ui/comments';
import type { CommentSidebarItem, CommentSidebarPanelApi } from '@services/comments/sidebar/comment-sidebar-contract';
import { createInpageCommentRootSource } from '@ui/comments/inpage-comment-root-source';
import { toDisplayCommentQuote } from '@services/comments/locator/comment-quote-policy';
import type { InpageCommentsDomSource } from '@services/bootstrap/inpage-comments-panel-content-handlers';

export type InpageCommentItem = CommentSidebarItem;
export type InpageCommentsPanelApi = CommentSidebarPanelApi;

const PANEL_ID = 'webclipper-inpage-comments-panel';

let singleton: { el: HTMLElement; api: CommentSidebarPanelApi } | null = null;
function isCommentsSelectionDebugEnabled(): boolean {
  const anyGlobal = globalThis as any;
  if (anyGlobal.__SYNCNOS_DEBUG_COMMENTS_SELECTION__ === true) return true;
  try {
    const storage = anyGlobal.window?.localStorage;
    return String(storage?.getItem?.('__SYNCNOS_DEBUG_COMMENTS_SELECTION__') || '') === '1';
  } catch (_e) {
    return false;
  }
}

function debugInpagePanel(event: string, payload: Record<string, unknown>) {
  if (!isCommentsSelectionDebugEnabled()) return;
  try {
    console.log('[CommentsSelection][inpage-panel]', event, payload);
  } catch (_e) {
    // ignore
  }
}

function ensurePanel(): { el: HTMLElement; api: CommentSidebarPanelApi } {
  if (singleton && document.getElementById(PANEL_ID) === singleton.el) return singleton;

  const existing = document.getElementById(PANEL_ID) as HTMLElement | null;
  if (existing && (existing as any).__webclipperPanelApi) {
    singleton = { el: existing, api: (existing as any).__webclipperPanelApi as CommentSidebarPanelApi };
    debugInpagePanel('ensure_existing_panel', { ok: true });
    return singleton;
  }

  const host = document.documentElement;
  const rootSource = createInpageCommentRootSource({
    document,
    getPanelRoot: () => singleton?.el || null,
  });
  const { el, api } = mountThreadedCommentsPanel(host, {
    overlay: true,
    dockPage: true,
    initiallyOpen: false,
    variant: 'sidebar',
    surface: 'inpage',
    surfaceBg: 'var(--bg-card)',
    showHeader: true,
    showCollapseButton: true,
    locatorEnv: 'inpage',
    getLocatorSurfaceRoots: () => rootSource.capture(document.getSelection()),
    getLocatorRoots: (locator) => rootSource.locate(locator),
  });
  el.id = PANEL_ID;

  (el as any).__webclipperPanelApi = api;
  singleton = { el, api };
  debugInpagePanel('ensure_new_panel', {
    ok: true,
    viewportWidth: Number(globalThis.innerWidth || 0) || 0,
  });
  return singleton;
}

const apiRef: InpageCommentsPanelApi = {
  attachHost(host) {
    debugInpagePanel('attach_host', {});
    return ensurePanel().api.attachHost(host);
  },
};

export function createInpageCommentsDomSource(input: {
  window: Window;
  document: Document;
  getPanelRoot?: () => Element | null;
}): InpageCommentsDomSource {
  const rootSource = createInpageCommentRootSource({
    document: input.document,
    getPanelRoot: input.getPanelRoot,
  });

  return {
    resolveComposerSelection() {
      try {
        const selection = input.document.getSelection();
        const roots = rootSource.capture(selection);
        if (!selection || selection.rangeCount !== 1 || !roots) return { selectionText: '', locator: null };
        const range = selection.getRangeAt(0);
        const selectionText = toDisplayCommentQuote(range.toString());
        if (!selectionText) return { selectionText: '', locator: null };
        const locator = rootSource.captureAnchor(selection);
        return { selectionText, locator };
      } catch (_error) {
        return { selectionText: '', locator: null };
      }
    },
    isTopFrame() {
      try {
        return input.window.top === input.window.self;
      } catch (_error) {
        return false;
      }
    },
    readPageUrl() {
      return String(input.window.location?.href || '');
    },
  };
}

export function getInpageCommentsPanelApi(): InpageCommentsPanelApi {
  return apiRef;
}
