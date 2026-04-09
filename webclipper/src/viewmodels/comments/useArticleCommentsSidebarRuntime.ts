import { useCallback, useRef, useSyncExternalStore } from 'react';

import { createArticleCommentsSidebarAppAdapter } from '@services/comments/sidebar/article-comments-sidebar-app-adapter';
import {
  createArticleCommentsSidebarController,
  type ArticleCommentsSidebarController,
} from '@services/comments/sidebar/article-comments-sidebar-controller';
import { buildArticleCommentLocatorFromRange } from '@services/comments/locator';
import type {
  CommentSidebarSession,
  CommentSidebarSessionSnapshot,
} from '@services/comments/sidebar/comment-sidebar-contract';
import { createCommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-session';

export type ArticleCommentsSidebarRuntime = {
  sidebarSession: CommentSidebarSession;
  sidebarController: ArticleCommentsSidebarController;
  sidebarSnapshot: CommentSidebarSessionSnapshot;
  setLocatorRoot: (root: Element | null) => void;
  getLocatorRoot: () => Element | null;
  subscribeSidebarClose: (listener: () => void) => () => void;
};

export function useArticleCommentsSidebarRuntime(input: { onClose?: () => void } = {}): ArticleCommentsSidebarRuntime {
  const onCloseRef = useRef<(() => void) | undefined>(input.onClose);
  onCloseRef.current = input.onClose;
  const closeListenersRef = useRef<Set<() => void>>(new Set());
  const locatorRootRef = useRef<Element | null>(null);

  const resolveAppSelectionPayload = () => {
    const root = locatorRootRef.current;
    if (!root) return { selectionText: '', locator: null };
    try {
      const selection = globalThis.getSelection?.();
      if (!selection || selection.rangeCount <= 0) return { selectionText: '', locator: null };
      const text = String(selection.toString() || '').trim();
      if (!text) return { selectionText: '', locator: null };

      const anchorNode = selection.anchorNode as Node | null;
      const focusNode = selection.focusNode as Node | null;
      if ((anchorNode && !root.contains(anchorNode)) || (focusNode && !root.contains(focusNode))) {
        return { selectionText: '', locator: null };
      }

      const range = selection.getRangeAt(0)?.cloneRange?.();
      if (!range) return { selectionText: text, locator: null };

      return {
        selectionText: text,
        locator:
          buildArticleCommentLocatorFromRange({
            env: 'app',
            root,
            range,
          }) ?? null,
      };
    } catch (_error) {
      return { selectionText: '', locator: null };
    }
  };

  const sidebarSessionRef = useRef<CommentSidebarSession | null>(null);
  if (!sidebarSessionRef.current) {
    sidebarSessionRef.current = createCommentSidebarSession();
  }
  const sidebarSession = sidebarSessionRef.current;

  const sidebarControllerRef = useRef<ArticleCommentsSidebarController | null>(null);
  if (!sidebarControllerRef.current) {
    sidebarControllerRef.current = createArticleCommentsSidebarController({
      session: sidebarSession,
      adapter: createArticleCommentsSidebarAppAdapter(),
      resolveComposerSelection: () => resolveAppSelectionPayload(),
      onClose: () => {
        onCloseRef.current?.();
        for (const listener of closeListenersRef.current) {
          try {
            listener();
          } catch (_error) {
            // ignore
          }
        }
      },
    });
  }
  const sidebarController = sidebarControllerRef.current;

  const sidebarSnapshot = useSyncExternalStore(
    (listener) => sidebarSession.subscribe(listener),
    () => sidebarSession.getSnapshot(),
    () => sidebarSession.getSnapshot(),
  );

  const setLocatorRoot = useCallback((root: Element | null) => {
    locatorRootRef.current = root;
  }, []);
  const getLocatorRoot = useCallback(() => locatorRootRef.current, []);
  const subscribeSidebarClose = useCallback((listener: () => void) => {
    if (typeof listener !== 'function') return () => {};
    closeListenersRef.current.add(listener);
    return () => {
      closeListenersRef.current.delete(listener);
    };
  }, []);

  return {
    sidebarSession,
    sidebarController,
    sidebarSnapshot,
    setLocatorRoot,
    getLocatorRoot,
    subscribeSidebarClose,
  };
}
