import { useEffect, useRef } from 'react';

import {
  mountThreadedCommentsPanel,
  type ThreadedCommentsPanelApi,
  type CommentLocatorSurfaceRoots,
} from '@ui/comments';
import { captureUniqueExactCommentAnchor } from '@services/comments/locator/capture-comment-anchor';
import type {
  CommentSidebarHost,
  CommentSidebarPanelApi,
  CommentSidebarSession,
} from '@services/comments/sidebar/comment-sidebar-contract';

export type ArticleCommentsSectionProps = {
  sidebarSession: CommentSidebarSession;
  containerClassName?: string;
  getLocatorSurfaceRoots: () => CommentLocatorSurfaceRoots | null;
  subscribeLocatorSurfaceRoots?: (listener: () => void) => () => void;
  fullWidth?: boolean;
};

function withAppImportedLocators(host: CommentSidebarHost, roots: CommentLocatorSurfaceRoots | null) {
  const snapshot = host.getSnapshot();
  if (!roots?.sourceRoot || !snapshot.comments.length) return snapshot;

  let changed = false;
  const comments = snapshot.comments.map((item) => {
    if (
      item.locator ||
      item.parentId != null ||
      item.importSource !== 'dedao' ||
      !item.importKey ||
      !String(item.quoteText || '')
    ) {
      return item;
    }

    const locator = captureUniqueExactCommentAnchor({
      root: roots.sourceRoot,
      exact: item.quoteText,
      surfaceHint: 'app',
    });
    if (!locator) return item;
    changed = true;
    return { ...item, locator };
  });

  return changed ? { ...snapshot, comments } : snapshot;
}

function createAppLocatorPanel(input: {
  panel: ThreadedCommentsPanelApi;
  getRoots: () => CommentLocatorSurfaceRoots | null;
  subscribeRoots: () => ((listener: () => void) => () => void) | undefined;
}): CommentSidebarPanelApi {
  return {
    attachHost(host) {
      const decoratedHost: CommentSidebarHost = {
        getSnapshot: () => withAppImportedLocators(host, input.getRoots()),
        subscribe(listener) {
          const unsubscribeHost = host.subscribe(listener);
          const subscribeRoots = input.subscribeRoots();
          const unsubscribeRoots =
            typeof subscribeRoots === 'function'
              ? subscribeRoots(() => {
                  listener();
                  input.panel.refreshLocatorRoots();
                })
              : () => {};
          return () => {
            unsubscribeRoots();
            unsubscribeHost();
          };
        },
        actions: host.actions,
      };
      return input.panel.attachHost(decoratedHost);
    },
  };
}

export function ArticleCommentsSection(props: ArticleCommentsSectionProps) {
  return <ArticleCommentsPanelMount {...props} />;
}

function ArticleCommentsPanelMount({
  sidebarSession,
  containerClassName,
  getLocatorSurfaceRoots,
  subscribeLocatorSurfaceRoots,
  fullWidth,
}: {
  sidebarSession: CommentSidebarSession;
  containerClassName?: string;
  getLocatorSurfaceRoots: () => CommentLocatorSurfaceRoots | null;
  subscribeLocatorSurfaceRoots?: (listener: () => void) => () => void;
  fullWidth?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<ThreadedCommentsPanelApi | null>(null);
  const locatorSurfaceRootsGetterRef = useRef<() => CommentLocatorSurfaceRoots | null>(
    typeof getLocatorSurfaceRoots === 'function' ? getLocatorSurfaceRoots : () => null,
  );
  const locatorSurfaceRootsSubscriberRef = useRef<typeof subscribeLocatorSurfaceRoots>(subscribeLocatorSurfaceRoots);
  useEffect(() => {
    locatorSurfaceRootsGetterRef.current =
      typeof getLocatorSurfaceRoots === 'function' ? getLocatorSurfaceRoots : () => null;
    apiRef.current?.refreshLocatorRoots();
  }, [getLocatorSurfaceRoots]);

  useEffect(() => {
    locatorSurfaceRootsSubscriberRef.current = subscribeLocatorSurfaceRoots;
  }, [subscribeLocatorSurfaceRoots]);

  useEffect(() => {
    if (!hostRef.current) return;
    if (apiRef.current) return;
    const host = hostRef.current;

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      variant: 'sidebar',
      surface: fullWidth ? 'app-narrow' : 'app-wide',
      fullWidth,
      showHeader: true,
      showCollapseButton: true,
      surfaceBg: 'var(--bg-card)',
      locatorEnv: 'app',
      getLocatorSurfaceRoots: () => locatorSurfaceRootsGetterRef.current(),
      deferReactUpdates: true,
    });
    apiRef.current = mounted.api;
    const panelLease = sidebarSession.attachPanel(
      createAppLocatorPanel({
        panel: mounted.api,
        getRoots: () => locatorSurfaceRootsGetterRef.current(),
        subscribeRoots: () => locatorSurfaceRootsSubscriberRef.current,
      }),
    );

    return () => {
      panelLease.dispose();
      mounted.cleanup();
      apiRef.current = null;
    };
  }, [fullWidth, sidebarSession]);

  const sectionClassName = [containerClassName || '', 'tw-flex tw-min-h-0 tw-flex-col'].filter(Boolean).join(' ');

  return (
    <section className={sectionClassName}>
      <div ref={hostRef} className="tw-min-h-0 tw-flex-1" />
    </section>
  );
}
