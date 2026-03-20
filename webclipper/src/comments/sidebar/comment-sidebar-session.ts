import type {
  CommentSidebarHandlers,
  CommentSidebarItem,
  CommentSidebarOpenInput,
  CommentSidebarPanelApi,
  CommentSidebarSession,
  CommentSidebarSessionSnapshot,
} from './comment-sidebar-contract';

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
  let lastOpenSource: string | null = null;

  function syncPanelState() {
    if (!panel) return;
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
      panel.setHandlers(handlers);
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
  }

  function detachPanel() {
    panel = null;
  }

  function requestOpen(input?: CommentSidebarOpenInput) {
    openRequested = true;
    lastOpenSource = normalizeSource(input?.source);
    if (input?.focusComposer) focusRequested = true;
    flushOpenRequest();
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
  }

  function setQuoteText(text: string) {
    quoteText = normalizeCommentSidebarQuoteText(text);
    try {
      panel?.setQuoteText(quoteText);
    } catch (_e) {
      // ignore
    }
  }

  function setBusy(nextBusy: boolean) {
    busy = !!nextBusy;
    try {
      panel?.setBusy(busy);
    } catch (_e) {
      // ignore
    }
    if (!busy) flushOpenRequest();
  }

  function setComments(items: CommentSidebarItem[]) {
    comments = cloneCommentItems(Array.isArray(items) ? items : []);
    try {
      panel?.setComments(cloneCommentItems(comments));
    } catch (_e) {
      // ignore
    }
  }

  function setHandlers(nextHandlers: CommentSidebarHandlers) {
    handlers = nextHandlers || {};
    try {
      panel?.setHandlers(handlers);
    } catch (_e) {
      // ignore
    }
  }

  function getSnapshot(): CommentSidebarSessionSnapshot {
    return {
      attached: !!panel,
      isOpen: !!panel?.isOpen?.(),
      busy,
      openRequested,
      focusRequested,
      quoteText,
      commentCount: comments.length,
      hasHandlers: hasAnyHandlers(handlers),
      lastOpenSource,
    };
  }

  if (panel) {
    syncPanelState();
    flushOpenRequest();
  }

  return {
    attachPanel,
    detachPanel,
    requestOpen,
    requestClose,
    setQuoteText,
    setBusy,
    setComments,
    setHandlers,
    getSnapshot,
  };
}
