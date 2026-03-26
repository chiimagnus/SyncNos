import { useEffect, useRef } from 'react';

import {
  mountThreadedCommentsPanel,
  type ThreadedCommentsPanelApi,
  type ThreadedCommentsPanelChatWithAction,
} from '@ui/comments/threaded-comments-panel';
import { createCommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-session';
import type { CommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-contract';
import { createArticleCommentsSidebarController } from '@services/comments/sidebar/article-comments-sidebar-controller';
import { createArticleCommentsSidebarAppAdapter } from '@services/comments/sidebar/article-comments-sidebar-app-adapter';

function safeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeHttpUrl(raw: unknown): string {
  const text = safeString(raw);
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = safeString(url.protocol).toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

type SidebarModeProps = {
  sidebarSession: CommentSidebarSession;
  containerClassName?: string;
  getLocatorRoot?: () => Element | null;
  resolveChatWithActions?: () => Promise<ThreadedCommentsPanelChatWithAction[]>;
  resolveChatWithSingleActionLabel?: () => Promise<string | null>;
};

type EmbeddedModeProps = {
  sidebarSession?: undefined;
  conversationId: number;
  canonicalUrl: string;
  containerClassName?: string;
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
        variant="sidebar"
      />
    );
  }

  return (
    <ArticleCommentsEmbedded
      conversationId={props.conversationId}
      canonicalUrl={props.canonicalUrl}
      containerClassName={props.containerClassName}
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
  variant,
}: {
  sidebarSession: CommentSidebarSession;
  containerClassName?: string;
  getLocatorRoot?: () => Element | null;
  resolveChatWithActions?: () => Promise<ThreadedCommentsPanelChatWithAction[]>;
  resolveChatWithSingleActionLabel?: () => Promise<string | null>;
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
      surfaceBg: 'var(--bg-primary)',
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
    });
    apiRef.current = mounted.api;
    sidebarSession.attachPanel(mounted.api as any);

    return () => {
      sidebarSession.detachPanel();
      mounted.cleanup();
      apiRef.current = null;
    };
  }, [resolveChatWithActions, resolveChatWithSingleActionLabel, sidebarSession, variant]);

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
  variant,
}: {
  conversationId: number;
  canonicalUrl: string;
  containerClassName?: string;
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
      canonicalUrl: normalizeHttpUrl(canonicalUrl),
      conversationId: Number(conversationId) > 0 ? Number(conversationId) : null,
    });
    void controller.refresh();
  }, [canonicalUrl, conversationId, controller]);

  return (
    <ArticleCommentsPanelMount
      sidebarSession={session}
      containerClassName={containerClassName}
      variant={variant === 'sidebar' ? 'sidebar' : 'embedded'}
    />
  );
}
