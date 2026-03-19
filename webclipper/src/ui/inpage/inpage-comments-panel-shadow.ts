import { mountThreadedCommentsPanel, type ThreadedCommentItem, type ThreadedCommentsPanelApi } from '../comments/threaded-comments-panel';

export type InpageCommentItem = ThreadedCommentItem;
export type InpageCommentsPanelApi = Omit<ThreadedCommentsPanelApi, 'open'> & {
  open: (input?: { focusEditor?: boolean }) => void;
};

const PANEL_ID = 'webclipper-threaded-comments-panel-overlay';
const LEGACY_PANEL_SELECTORS = [
  '#webclipper-inpage-comments-panel',
  'webclipper-inpage-comments-panel',
] as const;

let singleton: { el: HTMLElement; api: ThreadedCommentsPanelApi } | null = null;
let legacyCleared = false;

function ensurePanel(): { el: HTMLElement; api: ThreadedCommentsPanelApi } {
  if (singleton && document.getElementById(PANEL_ID) === singleton.el) return singleton;

  if (!legacyCleared) {
    legacyCleared = true;
    for (const selector of LEGACY_PANEL_SELECTORS) {
      try {
        document.querySelectorAll(selector).forEach((node) => {
          try {
            (node as any).remove?.();
          } catch (_e) {
            // ignore
          }
        });
      } catch (_e) {
        // ignore
      }
    }
  }

  const existing = document.getElementById(PANEL_ID) as HTMLElement | null;
  if (existing && (existing as any).__webclipperPanelApi) {
    singleton = { el: existing, api: (existing as any).__webclipperPanelApi as ThreadedCommentsPanelApi };
    return singleton;
  }

  const host = document.documentElement;
  const { el, api } = mountThreadedCommentsPanel(host, { overlay: true, initiallyOpen: false, title: 'Comments' });
  el.id = PANEL_ID;

  (el as any).__webclipperPanelApi = api;
  singleton = { el, api };
  return singleton;
}

const apiRef: InpageCommentsPanelApi = {
  open(input) {
    const { api } = ensurePanel();
    api.open({ focusComposer: input?.focusEditor === true });
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
  setTitle(title) {
    ensurePanel().api.setTitle(title);
  },
};

export function getInpageCommentsPanelApi(): InpageCommentsPanelApi {
  return apiRef;
}
