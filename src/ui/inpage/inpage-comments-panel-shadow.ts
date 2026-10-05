import { mountThreadedCommentsPanel } from '@ui/comments';
import type { CommentSidebarItem, CommentSidebarPanelApi } from '@services/comments/sidebar/comment-sidebar-contract';
import { createInpageCommentRootSource } from '@ui/comments/inpage-comment-root-source';
import { toCanonicalCommentQuote } from '@services/comments/locator/comment-quote-policy';
import type { InpageCommentsDomSource } from '@services/bootstrap/inpage-comments-panel-content-handlers';

export type InpageCommentItem = CommentSidebarItem;
export type InpageCommentsPanelApi = CommentSidebarPanelApi;

const PANEL_ID = 'webclipper-inpage-comments-panel';

let singleton: { el: HTMLElement; api: CommentSidebarPanelApi; cleanup: () => void } | null = null;
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

function removeExistingPanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}

function ensurePanel(): { el: HTMLElement; api: CommentSidebarPanelApi; cleanup: () => void } {
  if (singleton && document.getElementById(PANEL_ID) === singleton.el) return singleton;

  // DOM survives an extension reload; callbacks/runtime do not. Always replace a stale panel.
  removeExistingPanel();
  singleton = null;

  const host = document.documentElement;
  const rootSource = createInpageCommentRootSource({
    document,
    getPanelRoot: () => singleton?.el || null,
  });
  const mounted = mountThreadedCommentsPanel(host, {
    surface: 'inpage',
    getLocatorSurfaceRoots: () => rootSource.capture(document.getSelection()),
    getLocatorRoots: (locator) => rootSource.locate(locator),
  });
  const { el, api } = mounted;
  el.id = PANEL_ID;

  const cleanup = () => {
    mounted.cleanup();
    if (singleton?.el === el) singleton = null;
  };
  singleton = { el, api, cleanup };
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
        const locator = rootSource.captureAnchor(selection);
        const selectionText = locator?.quote.exact ?? toCanonicalCommentQuote(range.toString());
        if (!selectionText) return { selectionText: '', locator: null };
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

export function isInpageCommentsPanelOpen(): boolean {
  return document.getElementById(PANEL_ID)?.getAttribute('data-open') === '1';
}

export function cleanupInpageCommentsPanel(): void {
  const current = singleton;
  singleton = null;
  if (current && document.getElementById(PANEL_ID) === current.el) current.cleanup();
  else removeExistingPanel();
}

export function getInpageCommentsPanelApi(): InpageCommentsPanelApi {
  return apiRef;
}
