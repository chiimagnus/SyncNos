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
  fullWidth?: boolean;
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
        fullWidth={props.fullWidth}
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
  fullWidth,
  variant,
}: {
  sidebarSession: CommentSidebarSession;
  containerClassName?: string;
  getLocatorRoot?: () => Element | null;
  resolveChatWithActions?: () => Promise<ThreadedCommentsPanelChatWithAction[]>;
  resolveChatWithSingleActionLabel?: () => Promise<string | null>;
  commentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
  fullWidth?: boolean;
  variant?: 'embedded' | 'sidebar';
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<ThreadedCommentsPanelApi | null>(null);
  const locatorRootGetterRef = useRef<(() => Element | null) | null>(null);
  const resolveChatWithActionsRef = useRef<typeof resolveChatWithActions>(
    typeof resolveChatWithActions === 'function' ? resolveChatWithActions : undefined,
  );
  const resolveChatWithSingleActionLabelRef = useRef<typeof resolveChatWithSingleActionLabel>(
    typeof resolveChatWithSingleActionLabel === 'function' ? resolveChatWithSingleActionLabel : undefined,
  );
  const commentChatWithRef = useRef<ThreadedCommentsPanelCommentChatWithConfig | null>(
    commentChatWith && typeof commentChatWith.resolveActions === 'function' ? commentChatWith : null,
  );
  const hasSidebarChatWith = variant === 'sidebar' && typeof resolveChatWithActions === 'function';
  const hasCommentChatWith = !!commentChatWith && typeof commentChatWith.resolveActions === 'function';

  useEffect(() => {
    locatorRootGetterRef.current = typeof getLocatorRoot === 'function' ? getLocatorRoot : null;
  }, [getLocatorRoot]);

  useEffect(() => {
    resolveChatWithActionsRef.current =
      typeof resolveChatWithActions === 'function' ? resolveChatWithActions : undefined;
  }, [resolveChatWithActions]);

  useEffect(() => {
    resolveChatWithSingleActionLabelRef.current =
      typeof resolveChatWithSingleActionLabel === 'function' ? resolveChatWithSingleActionLabel : undefined;
  }, [resolveChatWithSingleActionLabel]);

  useEffect(() => {
    commentChatWithRef.current =
      commentChatWith && typeof commentChatWith.resolveActions === 'function' ? commentChatWith : null;
  }, [commentChatWith]);

  useEffect(() => {
    if (!hostRef.current) return;
    if (apiRef.current) return;
    const host = hostRef.current;

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      variant: variant === 'sidebar' ? 'sidebar' : 'embedded',
      fullWidth,
      showHeader: true,
      showCollapseButton: variant === 'sidebar',
      surfaceBg: 'var(--bg-card)',
      locatorEnv: variant === 'sidebar' ? 'app' : null,
      getLocatorRoot: () =>
        locatorRootGetterRef.current?.() ?? (document.querySelector('.route-scroll') as Element | null) ?? null,
      chatWith: hasSidebarChatWith
        ? {
            resolveActions: async () => {
              const resolver = resolveChatWithActionsRef.current;
              if (typeof resolver !== 'function') return [];
              return await resolver();
            },
            resolveSingleActionLabel: async () => {
              const resolver = resolveChatWithSingleActionLabelRef.current;
              if (typeof resolver !== 'function') return null;
              return await resolver();
            },
          }
        : null,
      commentChatWith: hasCommentChatWith
        ? {
            resolveActions: async (rootComment, context) => {
              const resolver = commentChatWithRef.current?.resolveActions;
              if (typeof resolver !== 'function') return [];
              return await resolver(rootComment, context);
            },
            resolveContext: async () => {
              const resolver = commentChatWithRef.current?.resolveContext;
              if (typeof resolver !== 'function') return {};
              return await resolver();
            },
          }
        : null,
    });
    apiRef.current = mounted.api;
    sidebarSession.attachPanel(mounted.api as any);

    return () => {
      sidebarSession.detachPanel();
      mounted.cleanup();
      apiRef.current = null;
    };
  }, [fullWidth, hasCommentChatWith, hasSidebarChatWith, sidebarSession, variant]);

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
