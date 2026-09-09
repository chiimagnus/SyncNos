import { flushSync } from 'react-dom';

import type {
  CommentSidebarHostActionCallbacks,
  CommentSidebarItem,
  CommentSidebarPanelApi,
} from '@services/comments/sidebar/comment-sidebar-contract';
import { createCommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-session';

export type CommentSidebarTestItemInput = Partial<CommentSidebarItem> & {
  id: number;
  commentText: string;
};

export type CommentSidebarPanelTestDriver = {
  session: ReturnType<typeof createCommentSidebarSession>;
  open: (input?: { focusComposer?: boolean }) => void;
  close: () => void;
  isOpen: () => boolean;
  updateBusy: (busy: boolean) => void;
  updateComposerQuote: (text: string) => void;
  replaceComments: (items: CommentSidebarTestItemInput[]) => void;
  replaceActionCallbacks: (callbacks: CommentSidebarHostActionCallbacks) => void;
  dispose: () => void;
};

const drivers = new WeakMap<object, CommentSidebarPanelTestDriver>();

function publish(callback: () => void): void {
  try {
    flushSync(callback);
  } catch (_error) {
    callback();
  }
}

function toCommentSidebarItem(input: CommentSidebarTestItemInput, index: number): CommentSidebarItem {
  const createdAt = Number(input.createdAt);
  const updatedAt = Number(input.updatedAt);
  return {
    id: Number(input.id),
    parentId: input.parentId == null ? null : Number(input.parentId),
    conversationId: input.conversationId == null ? null : Number(input.conversationId),
    canonicalUrl: String(input.canonicalUrl || 'https://example.com/article'),
    authorName: input.authorName == null ? null : String(input.authorName),
    quoteText: String(input.quoteText || ''),
    commentText: String(input.commentText),
    locator: input.locator || null,
    ...(input.importSource && input.importKey
      ? { importSource: String(input.importSource), importKey: String(input.importKey) }
      : {}),
    createdAt: Number.isFinite(createdAt) ? createdAt : index + 1,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Number.isFinite(createdAt) ? createdAt : index + 1,
  };
}

export function createCommentSidebarPanelTestDriver(api: CommentSidebarPanelApi): CommentSidebarPanelTestDriver {
  const session = createCommentSidebarSession();
  const lease = session.attachPanel(api);
  const installCallbacks = (callbacks: CommentSidebarHostActionCallbacks = {}) => {
    session.updateHost({
      actionCallbacks: {
        ...callbacks,
        onClose: () => {
          session.requestClose();
          callbacks.onClose?.();
        },
      },
    });
  };
  publish(() => {
    installCallbacks();
    session.requestOpen({ source: 'test' });
  });
  let disposed = false;

  return {
    session,
    open(input) {
      publish(() => {
        session.requestOpen({ focusComposer: input?.focusComposer === true, source: 'test' });
      });
    },
    close() {
      publish(() => {
        session.requestClose();
      });
    },
    isOpen() {
      return session.getSnapshot().open;
    },
    updateBusy(busy) {
      publish(() => {
        session.updateHost({ busy: busy === true });
      });
    },
    updateComposerQuote(text) {
      publish(() => {
        session.setComposerAttachment({ displayQuote: String(text || ''), locator: null });
      });
    },
    replaceComments(items) {
      publish(() => {
        session.updateHost({
          comments: Array.isArray(items) ? items.map(toCommentSidebarItem) : [],
        });
      });
    },
    replaceActionCallbacks(callbacks) {
      publish(() => {
        installCallbacks(callbacks || {});
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lease.dispose();
      session.dispose();
    },
  };
}

export function getCommentSidebarPanelTestDriver(api: CommentSidebarPanelApi): CommentSidebarPanelTestDriver {
  const key = api as object;
  const existing = drivers.get(key);
  if (existing) return existing;
  const driver = createCommentSidebarPanelTestDriver(api);
  drivers.set(key, driver);
  return driver;
}
