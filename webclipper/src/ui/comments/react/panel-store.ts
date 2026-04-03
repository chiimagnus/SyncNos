import type { ThreadedCommentItem } from '../types';
import type { ThreadedCommentsPanelHandlers, ThreadedCommentsPanelSnapshot } from './types';

export type ThreadedCommentsPanelStore = {
  getSnapshot: () => ThreadedCommentsPanelSnapshot;
  subscribe: (listener: () => void) => () => void;
  setOpen: (open: boolean) => void;
  setBusy: (busy: boolean) => void;
  setQuoteText: (text: string) => void;
  setComments: (items: ThreadedCommentItem[]) => void;
  setHandlers: (handlers: ThreadedCommentsPanelHandlers) => void;
  setFocusComposerSignal: (signal: number) => void;
  setEscapeSignal: (signal: number) => void;
  setNotice: (input: { message: string; visible: boolean }) => void;
  setHasFocusWithinPanel: (value: boolean) => void;
  setPendingFocusRootId: (rootId: number | null) => void;
};

function cloneComments(items: ThreadedCommentItem[]): ThreadedCommentItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({ ...item }));
}

function normalizeHandlers(handlers: ThreadedCommentsPanelHandlers): ThreadedCommentsPanelHandlers {
  return handlers && typeof handlers === 'object' ? { ...handlers } : {};
}

export function createThreadedCommentsPanelStore(): ThreadedCommentsPanelStore {
  let snapshot: ThreadedCommentsPanelSnapshot = {
    open: false,
    busy: false,
    quoteText: '',
    comments: [],
    handlers: {},
    focusComposerSignal: 0,
    escapeSignal: 0,
    noticeMessage: '',
    noticeVisible: false,
    hasFocusWithinPanel: false,
    pendingFocusRootId: null,
  };

  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (_error) {
        // ignore
      }
    }
  };

  const patch = (next: Partial<ThreadedCommentsPanelSnapshot>) => {
    snapshot = {
      ...snapshot,
      ...next,
    };
    notify();
  };

  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setOpen(open) {
      patch({ open: open === true });
    },
    setBusy(busy) {
      patch({ busy: busy === true });
    },
    setQuoteText(text) {
      patch({ quoteText: String(text || '') });
    },
    setComments(items) {
      patch({ comments: cloneComments(items) });
    },
    setHandlers(handlers) {
      patch({ handlers: normalizeHandlers(handlers) });
    },
    setFocusComposerSignal(signal) {
      const nextSignal = Number(signal);
      patch({ focusComposerSignal: Number.isFinite(nextSignal) ? nextSignal : snapshot.focusComposerSignal });
    },
    setEscapeSignal(signal) {
      const nextSignal = Number(signal);
      patch({ escapeSignal: Number.isFinite(nextSignal) ? nextSignal : snapshot.escapeSignal });
    },
    setNotice(input) {
      patch({
        noticeMessage: String(input?.message || ''),
        noticeVisible: input?.visible === true,
      });
    },
    setHasFocusWithinPanel(value) {
      patch({ hasFocusWithinPanel: value === true });
    },
    setPendingFocusRootId(rootId) {
      const normalized = Number(rootId);
      patch({
        pendingFocusRootId: Number.isFinite(normalized) && normalized > 0 ? Math.round(normalized) : null,
      });
    },
  };
}
