import type {
  CommentSidebarHandlers,
  CommentSidebarItem,
  CommentSidebarOpenInput,
  CommentSidebarPanelApi,
  CommentSidebarSession,
  CommentSidebarSessionSnapshot,
} from '@services/comments/sidebar/comment-sidebar-contract';

export function normalizeCommentSidebarQuoteText(text: unknown): string {
  return String(text ?? '').replace(/\r\n?/g, '\n');
}

function normalizeSource(source: unknown): string | null {
  const text = String(source ?? '').trim();
  return text ? text : null;
}

function cloneCommentItems(items: CommentSidebarItem[]): CommentSidebarItem[] {
  return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
}

function hasAnyHandlers(handlers: CommentSidebarHandlers): boolean {
  return !!handlers && Object.keys(handlers).length > 0;
}

export function createCommentSidebarSession(initialPanel?: CommentSidebarPanelApi | null): CommentSidebarSession {
  let panel: CommentSidebarPanelApi | null = initialPanel ?? null;
  let busy = false;
  let quoteText = '';
  let comments: CommentSidebarItem[] = [];
  let handlers: CommentSidebarHandlers = {};
  let openRequested = false;
  let focusRequested = false;
  let focusComposerSignal = 0;
  let lastOpenSource: string | null = null;
  const listeners = new Set<() => void>();
  let snapshotCache: CommentSidebarSessionSnapshot = buildSnapshot();

  function notify() {
    for (const listener of listeners) {
      try {
        listener();
      } catch (_e) {
        // ignore
      }
    }
  }

  function buildSnapshot(): CommentSidebarSessionSnapshot {
    return {
      attached: !!panel,
      isOpen: !!panel?.isOpen?.(),
      busy,
      openRequested,
      focusRequested,
      focusComposerSignal,
      quoteText,
      commentCount: comments.length,
      hasHandlers: hasAnyHandlers(handlers),
      lastOpenSource,
    };
  }

  function commit() {
    snapshotCache = buildSnapshot();
    notify();
  }

  function syncPanelState() {
    if (!panel) return;
    try {
      panel.setHandlers(handlers);
    } catch (_e) {
      // ignore
    }
    try {
      panel.setQuoteText(quoteText);
    } catch (_e) {
      // ignore; a detached host should not break the session state.
    }
    try {
      panel.setComments(cloneCommentItems(comments));
    } catch (_e) {
      // ignore
    }
    try {
      panel.setBusy(busy);
    } catch (_e) {
      // ignore
    }
  }

  function flushOpenRequest() {
    if (!panel || !openRequested || busy) return;
    const shouldFocus = focusRequested;
    try {
      panel.open({ focusComposer: shouldFocus });
      openRequested = false;
      focusRequested = false;
    } catch (_e) {
      // keep the request pending so another attach or busy flip can retry.
    }
  }

  function attachPanel(nextPanel: CommentSidebarPanelApi) {
    panel = nextPanel;
    syncPanelState();
    flushOpenRequest();
    commit();
  }

  function detachPanel() {
    panel = null;
    commit();
  }

  function subscribe(listener: () => void) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function requestOpen(input?: CommentSidebarOpenInput) {
    openRequested = true;
    lastOpenSource = normalizeSource(input?.source);
    if (input?.focusComposer) {
      focusRequested = true;
      focusComposerSignal += 1;
    }
    flushOpenRequest();
    commit();
  }

  function requestClose() {
    openRequested = false;
    focusRequested = false;
    lastOpenSource = null;
    try {
      panel?.close();
    } catch (_e) {
      // ignore
    }
    commit();
  }

  function setQuoteText(text: string) {
    quoteText = normalizeCommentSidebarQuoteText(text);
    try {
      panel?.setQuoteText(quoteText);
    } catch (_e) {
      // ignore
    }
    commit();
  }

  function setBusy(nextBusy: boolean) {
    busy = !!nextBusy;
    try {
      panel?.setBusy(busy);
    } catch (_e) {
      // ignore
    }
    if (!busy) flushOpenRequest();
    commit();
  }

  function setComments(items: CommentSidebarItem[]) {
    comments = cloneCommentItems(Array.isArray(items) ? items : []);
    try {
      panel?.setComments(cloneCommentItems(comments));
    } catch (_e) {
      // ignore
    }
    commit();
  }

  function setHandlers(nextHandlers: CommentSidebarHandlers) {
    const base = nextHandlers || {};
    const wrapped: CommentSidebarHandlers = { ...base };
    if (typeof base.onComposerSelectionRequest === 'function') {
      wrapped.onComposerSelectionRequest = async (input) => {
        await base.onComposerSelectionRequest?.(input);
      };
    }
    if (typeof base.onComposerQuoteClearRequest === 'function') {
      wrapped.onComposerQuoteClearRequest = async () => {
        await base.onComposerQuoteClearRequest?.();
      };
    }
    handlers = wrapped;
    try {
      panel?.setHandlers(handlers);
    } catch (_e) {
      // ignore
    }
    try {
      panel?.setComments(cloneCommentItems(comments));
    } catch (_e) {
      // ignore
    }
    commit();
  }

  function getSnapshot(): CommentSidebarSessionSnapshot {
    return snapshotCache;
  }

  if (panel) {
    syncPanelState();
    flushOpenRequest();
    snapshotCache = buildSnapshot();
  }

  return {
    attachPanel,
    detachPanel,
    subscribe,
    requestOpen,
    requestClose,
    setQuoteText,
    setBusy,
    setComments,
    setHandlers,
    getSnapshot,
  };
}
