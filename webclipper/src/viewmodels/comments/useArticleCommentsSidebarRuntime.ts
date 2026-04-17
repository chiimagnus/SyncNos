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

  const debugSelection = (event: string, payload: Record<string, unknown>) => {
    const anyGlobal = globalThis as any;
    const enabled =
      anyGlobal.__SYNCNOS_DEBUG_COMMENTS_SELECTION__ === true ||
      (() => {
        try {
          return String(anyGlobal.localStorage?.getItem?.('__SYNCNOS_DEBUG_COMMENTS_SELECTION__') || '') === '1';
        } catch (_e) {
          return false;
        }
      })();
    if (!enabled) return;
    try {
      console.log('[CommentsSelection][app]', event, payload);
    } catch (_e) {
      // ignore
    }
  };

  const resolveAppSelectionPayload = () => {
    const root = locatorRootRef.current;
    if (!root) {
      debugSelection('resolve_selection', { ok: false, reason: 'missing_locator_root' });
      return { selectionText: '', locator: null };
    }
    try {
      const selection = globalThis.getSelection?.();
      if (!selection || selection.rangeCount <= 0) {
        debugSelection('resolve_selection', {
          ok: false,
          reason: 'no_selection_range',
          selectionRangeCount: Number((selection as any)?.rangeCount || 0) || 0,
        });
        return { selectionText: '', locator: null };
      }
      const text = String(selection.toString() || '').trim();
      if (!text) {
        debugSelection('resolve_selection', { ok: false, reason: 'empty_text' });
        return { selectionText: '', locator: null };
      }

      const anchorNode = selection.anchorNode as Node | null;
      const focusNode = selection.focusNode as Node | null;
      if ((anchorNode && !root.contains(anchorNode)) || (focusNode && !root.contains(focusNode))) {
        debugSelection('resolve_selection', {
          ok: false,
          reason: 'selection_outside_locator_root',
          selectionTextLen: text.length,
        });
        return { selectionText: '', locator: null };
      }

      const range = selection.getRangeAt(0)?.cloneRange?.();
      if (!range) {
        debugSelection('resolve_selection', { ok: true, selectionTextLen: text.length, locatorOk: false });
        return { selectionText: text, locator: null };
      }

      const payload = {
        selectionText: text,
        locator:
          buildArticleCommentLocatorFromRange({
            env: 'app',
            root,
            range,
          }) ?? null,
      };
      debugSelection('resolve_selection', {
        ok: true,
        selectionTextLen: payload.selectionText.length,
        locatorOk: Boolean(payload.locator),
      });
      return payload;
    } catch (_error) {
      debugSelection('resolve_selection', { ok: false, reason: 'exception' });
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
