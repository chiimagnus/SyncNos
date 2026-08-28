import { useEffect, useRef } from 'react';

import {
  mountThreadedCommentsPanel,
  type ThreadedCommentsPanelApi,
  type CommentLocatorSurfaceRoots,
} from '@ui/comments';
import type { CommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-contract';

export type ArticleCommentsSectionProps = {
  sidebarSession: CommentSidebarSession;
  containerClassName?: string;
  getLocatorSurfaceRoots: () => CommentLocatorSurfaceRoots | null;
  subscribeLocatorSurfaceRoots?: (listener: () => void) => () => void;
  fullWidth?: boolean;
};

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
  useEffect(() => {
    locatorSurfaceRootsGetterRef.current =
      typeof getLocatorSurfaceRoots === 'function' ? getLocatorSurfaceRoots : () => null;
    apiRef.current?.refreshLocatorRoots();
  }, [getLocatorSurfaceRoots]);

  useEffect(() => {
    if (typeof subscribeLocatorSurfaceRoots !== 'function') return;
    return subscribeLocatorSurfaceRoots(() => apiRef.current?.refreshLocatorRoots());
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
    const panelLease = sidebarSession.attachPanel(mounted.api as any);

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
