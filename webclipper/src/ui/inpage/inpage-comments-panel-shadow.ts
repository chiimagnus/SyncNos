import { mountThreadedCommentsPanel, type ThreadedCommentItem, type ThreadedCommentsPanelApi } from '../comments/threaded-comments-panel';

export type InpageCommentItem = ThreadedCommentItem;
export type InpageCommentsPanelApi = Omit<ThreadedCommentsPanelApi, 'open'> & {
  open: (input?: { focusEditor?: boolean }) => void;
};

const PANEL_ID = 'webclipper-inpage-comments-panel';

function setImportantStyle(el: HTMLElement, name: string, value: string) {
  el.style.setProperty(name, value, 'important');
}

function applyPanelHostLayoutStyles(el: HTMLElement) {
  setImportantStyle(el, 'display', 'block');
  setImportantStyle(el, 'position', 'fixed');
  setImportantStyle(el, 'top', '0');
  setImportantStyle(el, 'right', '0');
  setImportantStyle(el, 'z-index', '2147483647');
  setImportantStyle(el, 'margin', '0');
  setImportantStyle(el, 'padding', '0');
  setImportantStyle(el, 'border', '0');
  setImportantStyle(el, 'background', 'transparent');
  setImportantStyle(el, 'pointer-events', 'auto');
  setImportantStyle(el, 'isolation', 'isolate');
}

let singleton: { el: HTMLElement; api: ThreadedCommentsPanelApi } | null = null;

function ensurePanel(): { el: HTMLElement; api: ThreadedCommentsPanelApi } {
  if (singleton && document.getElementById(PANEL_ID) === singleton.el) return singleton;

  const existing = document.getElementById(PANEL_ID) as HTMLElement | null;
  if (existing && (existing as any).__webclipperPanelApi) {
    singleton = { el: existing, api: (existing as any).__webclipperPanelApi as ThreadedCommentsPanelApi };
    return singleton;
  }

  const host = document.documentElement;
  const { el, api } = mountThreadedCommentsPanel(host, { overlay: true, initiallyOpen: false, title: 'Comments' });
  el.id = PANEL_ID;
  applyPanelHostLayoutStyles(el);
  // Hard default closed: only open on explicit user action.
  setImportantStyle(el, 'display', 'none');

  (el as any).__webclipperPanelApi = api;
  singleton = { el, api };
  return singleton;
}

const apiRef: InpageCommentsPanelApi = {
  open(input) {
    const { el, api } = ensurePanel();
    api.open({ focusComposer: input?.focusEditor === true });
    setImportantStyle(el, 'display', 'block');
  },
  close() {
    const el = document.getElementById(PANEL_ID) as HTMLElement | null;
    if (!el) return;
    setImportantStyle(el, 'display', 'none');
  },
  isOpen() {
    const el = document.getElementById(PANEL_ID) as HTMLElement | null;
    if (!el) return false;
    return (getComputedStyle(el).display || '') !== 'none';
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
  setTitle(title) {
    ensurePanel().api.setTitle(title);
  },
};

export function getInpageCommentsPanelApi(): InpageCommentsPanelApi {
  return apiRef;
}
