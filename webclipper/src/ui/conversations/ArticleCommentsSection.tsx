import { useEffect, useRef } from 'react';

import {
  mountThreadedCommentsPanel,
  type ThreadedCommentsPanelApi,
  type ThreadedCommentsPanelChatWithAction,
  type ThreadedCommentsPanelCommentChatWithConfig,
} from '@ui/comments';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import { createCommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-session';
import type { CommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-contract';
import { createArticleCommentsSidebarController } from '@services/comments/sidebar/article-comments-sidebar-controller';
import { createArticleCommentsSidebarAppAdapter } from '@services/comments/sidebar/article-comments-sidebar-app-adapter';

type SidebarModeProps = {
  sidebarSession: CommentSidebarSession;
  containerClassName?: string;
  getLocatorRoot?: () => Element | null;
  resolveChatWithActions?: () => Promise<ThreadedCommentsPanelChatWithAction[]>;
  resolveChatWithSingleActionLabel?: () => Promise<string | null>;
  commentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
};

type EmbeddedModeProps = {
  sidebarSession?: undefined;
  conversationId: number;
  canonicalUrl: string;
  containerClassName?: string;
  commentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
};

export function ArticleCommentsSection(props: SidebarModeProps | EmbeddedModeProps) {
  if ('sidebarSession' in props && props.sidebarSession) {
    return (
      <ArticleCommentsPanelMount
        sidebarSession={props.sidebarSession}
        containerClassName={props.containerClassName}
        getLocatorRoot={props.getLocatorRoot}
        resolveChatWithActions={props.resolveChatWithActions}
        resolveChatWithSingleActionLabel={props.resolveChatWithSingleActionLabel}
        commentChatWith={props.commentChatWith}
        variant="sidebar"
      />
    );
  }

  return (
    <ArticleCommentsEmbedded
      conversationId={props.conversationId}
      canonicalUrl={props.canonicalUrl}
      containerClassName={props.containerClassName}
      commentChatWith={props.commentChatWith}
      variant="embedded"
    />
  );
}

function ArticleCommentsPanelMount({
  sidebarSession,
  containerClassName,
  getLocatorRoot,
  resolveChatWithActions,
  resolveChatWithSingleActionLabel,
  commentChatWith,
  variant,
}: {
  sidebarSession: CommentSidebarSession;
  containerClassName?: string;
  getLocatorRoot?: () => Element | null;
  resolveChatWithActions?: () => Promise<ThreadedCommentsPanelChatWithAction[]>;
  resolveChatWithSingleActionLabel?: () => Promise<string | null>;
  commentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
  variant?: 'embedded' | 'sidebar';
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<ThreadedCommentsPanelApi | null>(null);
  const locatorRootGetterRef = useRef<(() => Element | null) | null>(null);

  useEffect(() => {
    locatorRootGetterRef.current = typeof getLocatorRoot === 'function' ? getLocatorRoot : null;
  }, [getLocatorRoot]);

  useEffect(() => {
    if (!hostRef.current) return;
    if (apiRef.current) return;
    const host = hostRef.current;

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      variant: variant === 'sidebar' ? 'sidebar' : 'embedded',
      showHeader: true,
      showCollapseButton: variant === 'sidebar',
      surfaceBg: 'var(--bg-card)',
      locatorEnv: variant === 'sidebar' ? 'app' : null,
      getLocatorRoot: () =>
        locatorRootGetterRef.current?.() ?? (document.querySelector('.route-scroll') as Element | null) ?? null,
      chatWith:
        variant === 'sidebar' && typeof resolveChatWithActions === 'function'
          ? {
              resolveActions: resolveChatWithActions,
              resolveSingleActionLabel:
                typeof resolveChatWithSingleActionLabel === 'function' ? resolveChatWithSingleActionLabel : undefined,
            }
          : null,
      commentChatWith: commentChatWith && typeof commentChatWith.resolveActions === 'function' ? commentChatWith : null,
    });
    apiRef.current = mounted.api;
    sidebarSession.attachPanel(mounted.api as any);

    return () => {
      sidebarSession.detachPanel();
      mounted.cleanup();
      apiRef.current = null;
    };
  }, [commentChatWith, resolveChatWithActions, resolveChatWithSingleActionLabel, sidebarSession, variant]);

  const sectionClassName = [containerClassName || '', 'tw-flex tw-min-h-0 tw-flex-col'].filter(Boolean).join(' ');

  return (
    <section className={sectionClassName}>
      <div ref={hostRef} className="tw-min-h-0 tw-flex-1" />
    </section>
  );
}

function ArticleCommentsEmbedded({
  conversationId,
  canonicalUrl,
  containerClassName,
  commentChatWith,
  variant,
}: {
  conversationId: number;
  canonicalUrl: string;
  containerClassName?: string;
  commentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
  variant?: 'embedded' | 'sidebar';
}) {
  const sessionRef = useRef<CommentSidebarSession | null>(null);
  const controllerRef = useRef<ReturnType<typeof createArticleCommentsSidebarController> | null>(null);

  if (!sessionRef.current) sessionRef.current = createCommentSidebarSession();
  const session = sessionRef.current;

  if (!controllerRef.current) {
    controllerRef.current = createArticleCommentsSidebarController({
      session,
      adapter: createArticleCommentsSidebarAppAdapter(),
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controller.setContext({
      canonicalUrl: canonicalizeArticleUrl(canonicalUrl),
      conversationId: Number(conversationId) > 0 ? Number(conversationId) : null,
    });
  }, [canonicalUrl, conversationId, controller]);

  return (
    <ArticleCommentsPanelMount
      sidebarSession={session}
      containerClassName={containerClassName}
      commentChatWith={commentChatWith}
      variant={variant === 'sidebar' ? 'sidebar' : 'embedded'}
    />
  );
}
