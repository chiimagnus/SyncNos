import { normalizeArticleCommentLocator } from '@services/comments/domain/comment-locator';
import type {
  CommentSidebarComposerAttachment,
  CommentSidebarHost,
  CommentSidebarHostActionCallbacks,
  CommentSidebarHostSnapshot,
  CommentSidebarHostUpdate,
  CommentSidebarOpenInput,
  CommentSidebarPanelApi,
  CommentSidebarPanelLease,
  CommentSidebarSession,
} from '@services/comments/sidebar/comment-sidebar-contract';
import {
  createCommentSidebarHostActions,
  createCommentSidebarHostSnapshot,
} from '@services/comments/sidebar/comment-sidebar-state';

export function normalizeCommentSidebarQuoteText(text: unknown): string {
  return String(text ?? '').replace(/\r\n?/g, '\n');
}

function normalizeSource(source: unknown): string | null {
  const text = String(source ?? '').trim();
  return text ? text : null;
}

function createReleasedPanelLease(): CommentSidebarPanelLease {
  return Object.freeze({ dispose() {} });
}

type AttachedPanel = {
  id: number;
  lease: CommentSidebarPanelLease;
};

export function createCommentSidebarSession(initialPanel?: CommentSidebarPanelApi | null): CommentSidebarSession {
  let snapshot = createCommentSidebarHostSnapshot();
  let actionCallbacks: CommentSidebarHostActionCallbacks = {};
  let disposed = false;
  let panelLeaseSequence = 0;
  let attachedPanel: AttachedPanel | null = null;
  const listeners = new Set<() => void>();

  const actions = createCommentSidebarHostActions(() => (disposed ? {} : actionCallbacks));

  function getSnapshot(): CommentSidebarHostSnapshot {
    return snapshot;
  }

  function subscribe(listener: () => void) {
    if (disposed) return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function notify() {
    if (disposed) return;
    for (const listener of listeners) {
      try {
        listener();
      } catch (_error) {
        // Ignore one subscriber so the remaining subscribers still receive the update.
      }
    }
  }

  function publish(next: Partial<CommentSidebarHostSnapshot>) {
    if (disposed) return;
    snapshot = { ...snapshot, ...next };
    notify();
  }

  const host: CommentSidebarHost = Object.freeze({ getSnapshot, subscribe, actions });

  function attachPanel(nextPanel: CommentSidebarPanelApi): CommentSidebarPanelLease {
    if (disposed) return createReleasedPanelLease();

    attachedPanel?.lease.dispose();
    const id = ++panelLeaseSequence;
    const panelLease = nextPanel.attachHost(host);
    attachedPanel = { id, lease: panelLease || createReleasedPanelLease() };

    let released = false;
    return Object.freeze({
      dispose() {
        if (released) return;
        released = true;
        if (disposed || attachedPanel?.id !== id) return;
        const current = attachedPanel;
        attachedPanel = null;
        current.lease.dispose();
      },
    });
  }

  function requestOpen(input?: CommentSidebarOpenInput) {
    if (disposed) return;
    publish({
      open: true,
      focusComposerSignal: input?.focusComposer ? snapshot.focusComposerSignal + 1 : snapshot.focusComposerSignal,
      lastOpenSource: normalizeSource(input?.source),
    });
  }

  function requestClose() {
    if (disposed) return;
    publish({ open: false, lastOpenSource: null });
  }

  function setComposerAttachment(input: {
    displayQuote: string;
    locator?: CommentSidebarComposerAttachment['locator'];
  }): CommentSidebarComposerAttachment {
    if (disposed) return snapshot.composerAttachment;
    const nextAttachment = {
      displayQuote: normalizeCommentSidebarQuoteText(input.displayQuote),
      locator: normalizeArticleCommentLocator(input.locator),
      selectionRevision: snapshot.composerAttachment.selectionRevision + 1,
    };
    publish({ composerAttachment: nextAttachment });
    return snapshot.composerAttachment;
  }

  function clearComposerAttachment(expectedSelectionRevision?: number): boolean {
    if (disposed) return false;
    if (
      expectedSelectionRevision != null &&
      Number(expectedSelectionRevision) !== snapshot.composerAttachment.selectionRevision
    ) {
      return false;
    }
    publish({
      composerAttachment: {
        displayQuote: '',
        locator: null,
        selectionRevision: snapshot.composerAttachment.selectionRevision + 1,
      },
    });
    return true;
  }

  function updateHost(input: CommentSidebarHostUpdate) {
    if (disposed) return;
    if ('actionCallbacks' in input) {
      actionCallbacks = { ...(input.actionCallbacks ?? {}) };
    }
    const next: Partial<CommentSidebarHostSnapshot> = {};
    if ('busy' in input) next.busy = input.busy === true;
    if ('comments' in input) {
      next.comments = (input.comments ?? []).map((item) => ({
        ...item,
        locator: normalizeArticleCommentLocator(item.locator),
      }));
    }
    if ('loadStatus' in input) next.loadStatus = input.loadStatus;
    if ('loadError' in input) next.loadError = input.loadError ? { ...input.loadError } : null;
    if ('contextKey' in input) next.contextKey = String(input.contextKey ?? '');
    if (Object.keys(next).length) publish(next);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const currentPanel = attachedPanel;
    attachedPanel = null;
    currentPanel?.lease.dispose();
    actionCallbacks = {};
    snapshot = createCommentSidebarHostSnapshot();
    listeners.clear();
  }

  const session: CommentSidebarSession = {
    getSnapshot,
    subscribe,
    actions,
    attachPanel,
    requestOpen,
    requestClose,
    setComposerAttachment,
    clearComposerAttachment,
    updateHost,
    dispose,
  };

  if (initialPanel) attachPanel(initialPanel);

  return session;
}
