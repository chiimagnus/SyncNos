import type {
  CommentSidebarHost,
  CommentSidebarHostActions,
  CommentSidebarHostSnapshot,
  CommentSidebarPanelLease,
} from '@services/comments/sidebar/comment-sidebar-contract';
import { createCommentSidebarHostSnapshot } from '@services/comments/sidebar/comment-sidebar-state';
import type { ThreadedCommentsPanelSnapshot } from './types';

export type ThreadedCommentsPanelStore = {
  getSnapshot: () => ThreadedCommentsPanelSnapshot;
  subscribe: (listener: () => void) => () => void;
};

export type ThreadedCommentsPanelStoreController = {
  store: ThreadedCommentsPanelStore;
  actions: CommentSidebarHostActions;
  attachHost: (host: CommentSidebarHost) => CommentSidebarPanelLease;
  setNotice: (input: { message: string; visible: boolean }) => void;
  setHasFocusWithinPanel: (value: boolean) => void;
  setPendingFocusRootId: (rootId: number | null) => void;
  dispose: () => void;
};

type LocalPanelSnapshot = Pick<
  ThreadedCommentsPanelSnapshot,
  'noticeMessage' | 'noticeVisible' | 'hasFocusWithinPanel' | 'pendingFocusRootId'
>;

const EMPTY_LOCAL_SNAPSHOT: LocalPanelSnapshot = {
  noticeMessage: '',
  noticeVisible: false,
  hasFocusWithinPanel: false,
  pendingFocusRootId: null,
};

function combineSnapshots(
  hostSnapshot: CommentSidebarHostSnapshot,
  localSnapshot: LocalPanelSnapshot,
): ThreadedCommentsPanelSnapshot {
  return {
    ...hostSnapshot,
    ...localSnapshot,
  };
}

function releasedLease(): CommentSidebarPanelLease {
  return Object.freeze({ dispose() {} });
}

export function createThreadedCommentsPanelStore(): ThreadedCommentsPanelStoreController {
  let disposed = false;
  let currentHost: CommentSidebarHost | null = null;
  let currentHostUnsubscribe: (() => void) | null = null;
  let hostLeaseSequence = 0;
  let hostSnapshot = createCommentSidebarHostSnapshot();
  let localSnapshot: LocalPanelSnapshot = { ...EMPTY_LOCAL_SNAPSHOT };
  let snapshot = combineSnapshots(hostSnapshot, localSnapshot);
  const listeners = new Set<() => void>();

  const notify = () => {
    if (disposed) return;
    for (const listener of listeners) {
      try {
        listener();
      } catch (_error) {
        // Ignore one listener so other panel subscribers still update.
      }
    }
  };

  const rebuild = () => {
    snapshot = combineSnapshots(hostSnapshot, localSnapshot);
    notify();
  };

  const patchLocal = (next: Partial<LocalPanelSnapshot>) => {
    if (disposed) return;
    const entries = Object.entries(next) as [keyof LocalPanelSnapshot, LocalPanelSnapshot[keyof LocalPanelSnapshot]][];
    if (entries.every(([key, value]) => Object.is(localSnapshot[key], value))) return;
    localSnapshot = { ...localSnapshot, ...next };
    rebuild();
  };

  const readHostActions = () => (disposed ? null : currentHost?.actions || null);
  const actions: CommentSidebarHostActions = Object.freeze({
    save: (text) => readHostActions()?.save(text),
    reply: (parentId, text) => readHostActions()?.reply(parentId, text),
    delete: (id) => readHostActions()?.delete(id),
    close: () => readHostActions()?.close(),
    requestComposerSelection: (input) => readHostActions()?.requestComposerSelection(input),
    clearComposerAttachment: () => readHostActions()?.clearComposerAttachment(),
    retry: () => readHostActions()?.retry(),
  });

  const store: ThreadedCommentsPanelStore = Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed || typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });

  const detachCurrentHost = () => {
    currentHostUnsubscribe?.();
    currentHostUnsubscribe = null;
    currentHost = null;
    hostSnapshot = createCommentSidebarHostSnapshot();
  };

  const attachHost = (host: CommentSidebarHost): CommentSidebarPanelLease => {
    if (disposed || !host) return releasedLease();
    detachCurrentHost();
    const leaseId = ++hostLeaseSequence;
    currentHost = host;

    const syncHostSnapshot = () => {
      if (disposed || currentHost !== host || leaseId !== hostLeaseSequence) return;
      hostSnapshot = host.getSnapshot();
      rebuild();
    };

    currentHostUnsubscribe = host.subscribe(syncHostSnapshot);
    syncHostSnapshot();

    let released = false;
    return Object.freeze({
      dispose() {
        if (released) return;
        released = true;
        if (disposed || currentHost !== host || leaseId !== hostLeaseSequence) return;
        detachCurrentHost();
        rebuild();
      },
    });
  };

  return {
    store,
    actions,
    attachHost,
    setNotice(input) {
      patchLocal({
        noticeMessage: String(input?.message || ''),
        noticeVisible: input?.visible === true,
      });
    },
    setHasFocusWithinPanel(value) {
      patchLocal({ hasFocusWithinPanel: value === true });
    },
    setPendingFocusRootId(rootId) {
      const normalized = Number(rootId);
      patchLocal({
        pendingFocusRootId: Number.isFinite(normalized) && normalized > 0 ? Math.round(normalized) : null,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      detachCurrentHost();
      listeners.clear();
      localSnapshot = { ...EMPTY_LOCAL_SNAPSHOT };
      snapshot = combineSnapshots(hostSnapshot, localSnapshot);
    },
  };
}
