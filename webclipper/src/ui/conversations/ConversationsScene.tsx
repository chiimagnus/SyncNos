import { useEffect, useState } from 'react';

import { useIsNarrowScreen } from '@ui/shared/hooks/useIsNarrowScreen';
import { useNarrowListDetailCommentsRoute } from '@ui/shared/hooks/useNarrowListDetailCommentsRoute';
import type { ArticleCommentsSidebarRuntime } from '@viewmodels/comments/useArticleCommentsSidebarRuntime';

import { t, formatConversationTitle } from '@i18n';
import type { DetailHeaderAction } from '@services/integrations/detail-header-actions';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import type {
  ThreadedCommentsPanelChatWithAction,
  ThreadedCommentsPanelCommentChatWithConfig,
} from '@ui/comments';
import { ConversationDetailPane } from '@ui/conversations/ConversationDetailPane';
import { ConversationListPane } from '@ui/conversations/ConversationListPane';
import { ArticleCommentsSection } from '@ui/conversations/ArticleCommentsSection';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { consumePendingOpenConversation } from '@ui/conversations/pending-open';
import { columnDividerRightClassName } from '@ui/shared/column-styles';

type NarrowRoute = 'list' | 'detail' | 'comments';

export type PopupHeaderState =
  | { mode: 'list' }
  | {
      mode: 'detail';
      title: string;
      subtitle: string;
      actions: DetailHeaderAction[];
      onBack: () => void;
    };

export type ConversationsSceneProps = {
  defaultNarrowRoute?: NarrowRoute;
  onPopupHeaderStateChange?: (state: PopupHeaderState) => void;
  inlineNarrowDetailHeader?: boolean;
  onPopupNotionSyncStarted?: () => void;
  onOpenInsightsSection?: () => void;
  commentsSidebarRuntime?: ArticleCommentsSidebarRuntime;
  narrowCommentsOpenSource?: 'popup' | 'app';
  resolveCommentsSidebarChatWithActions?: () => Promise<ThreadedCommentsPanelChatWithAction[]>;
  resolveCommentsSidebarSingleChatWithLabel?: () => Promise<string | null>;
  commentsSidebarCommentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
};

function isArticleConversationLike(conversation: any): boolean {
  const sourceType = String(conversation?.sourceType || '')
    .trim()
    .toLowerCase();
  if (sourceType === 'article') return true;

  const source = String(conversation?.source || '')
    .trim()
    .toLowerCase();
  if (source !== 'web') return false;
  return Boolean(canonicalizeArticleUrl(conversation?.url));
}

export function ConversationsScene({
  defaultNarrowRoute = 'list',
  onPopupHeaderStateChange,
  inlineNarrowDetailHeader = false,
  onPopupNotionSyncStarted,
  onOpenInsightsSection,
  commentsSidebarRuntime,
  narrowCommentsOpenSource = 'popup',
  resolveCommentsSidebarChatWithActions,
  resolveCommentsSidebarSingleChatWithLabel,
  commentsSidebarCommentChatWith,
}: ConversationsSceneProps) {
  const isNarrow = useIsNarrowScreen();
  const {
    activeId,
    selectedConversation,
    detailHeaderActions,
    openConversationExternalBySourceKey,
    openConversationExternalById,
  } = useConversationsApp();
  const [listScrollTop, setListScrollTop] = useState(0);
  const {
    route: narrowRoute,
    openDetail,
    openComments,
    returnToDetail,
    returnToList,
    listRestoreKey,
  } = useNarrowListDetailCommentsRoute({
    isNarrow,
    defaultRoute: defaultNarrowRoute,
  });
  const [commentsOpenedInRoute, setCommentsOpenedInRoute] = useState(false);
  const selectedConversationCanonicalUrl = canonicalizeArticleUrl((selectedConversation as any)?.url);
  const canOpenCommentsFromDetail =
    Boolean(commentsSidebarRuntime) && isArticleConversationLike(selectedConversation) && Boolean(selectedConversationCanonicalUrl);

  useEffect(() => {
    if (!isNarrow) return;
    const pending = consumePendingOpenConversation();
    if (!pending) return;
    const id = Number(pending.conversationId);
    const source = String(pending.source || '').trim();
    const conversationKey = String(pending.conversationKey || '').trim();
    if (source && conversationKey) {
      void openConversationExternalBySourceKey(source, conversationKey);
    } else if (Number.isFinite(id) && id > 0) {
      void openConversationExternalById(id);
    } else {
      return;
    }
    openDetail();
  }, [isNarrow, openConversationExternalById, openConversationExternalBySourceKey, openDetail]);

  useEffect(() => {
    if (!onPopupHeaderStateChange) return;

    if (!isNarrow || narrowRoute === 'list') {
      onPopupHeaderStateChange({ mode: 'list' });
      return;
    }

    const title = activeId ? formatConversationTitle(selectedConversation?.title) : t('chatsTitle');
    const subtitle = activeId && selectedConversation ? String((selectedConversation as any).url || '').trim() : '';

    onPopupHeaderStateChange({
      mode: 'detail',
      title,
      subtitle,
      actions: detailHeaderActions,
      onBack: returnToList,
    });

    return () => {
      onPopupHeaderStateChange({ mode: 'list' });
    };
  }, [
    activeId,
    detailHeaderActions,
    isNarrow,
    narrowRoute,
    onPopupHeaderStateChange,
    returnToList,
    selectedConversation,
  ]);

  useEffect(() => {
    if (!isNarrow || narrowRoute !== 'comments') {
      setCommentsOpenedInRoute(false);
      return;
    }
    if (!commentsSidebarRuntime || commentsOpenedInRoute) return;
    setCommentsOpenedInRoute(true);
  }, [commentsOpenedInRoute, commentsSidebarRuntime, isNarrow, narrowRoute]);

  useEffect(() => {
    if (!commentsSidebarRuntime) return;
    return commentsSidebarRuntime.subscribeSidebarClose(() => {
      setCommentsOpenedInRoute(false);
      if (isNarrow && narrowRoute === 'comments') returnToDetail();
    });
  }, [commentsSidebarRuntime, isNarrow, narrowRoute, returnToDetail]);

  const list = (
    <ConversationListPane
      initialScrollTop={listScrollTop}
      scrollRestoreKey={listRestoreKey}
      onListScrollTopChange={setListScrollTop}
      onPopupNotionSyncStarted={onPopupNotionSyncStarted}
      onOpenConversation={() => {
        openDetail();
      }}
      onOpenInsightsSection={onOpenInsightsSection}
    />
  );

  if (isNarrow) {
    if (narrowRoute === 'detail') {
      return (
        <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-card)] tw-text-[var(--text-primary)]">
          <div className="route-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto tw-overflow-x-hidden tw-bg-[var(--bg-card)]">
            {inlineNarrowDetailHeader ? (
              <ConversationDetailPane
                onBack={returnToList}
                onTriggerCommentsSidebar={
                  canOpenCommentsFromDetail
                    ? ({ quoteText, locator }) => {
                        if (!commentsSidebarRuntime) return;
                        setCommentsOpenedInRoute(true);
                        openComments();
                        void commentsSidebarRuntime.sidebarController.open({
                          selectionText: String(quoteText || ''),
                          locator: locator ?? null,
                          focusComposer: true,
                          source: narrowCommentsOpenSource,
                          ensureContext: false,
                        });
                      }
                    : undefined
                }
                onCommentsLocatorRootChange={(root) => {
                  commentsSidebarRuntime?.setLocatorRoot(root);
                }}
              />
            ) : (
              <ConversationDetailPane hideHeader />
            )}
          </div>
        </div>
      );
    }

    if (narrowRoute === 'comments' && commentsSidebarRuntime) {
      return (
        <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-card)] tw-text-[var(--text-primary)]">
          <ArticleCommentsSection
            sidebarSession={commentsSidebarRuntime.sidebarSession}
            containerClassName="tw-h-full tw-min-h-0"
            getLocatorRoot={commentsSidebarRuntime.getLocatorRoot}
            resolveChatWithActions={resolveCommentsSidebarChatWithActions}
            resolveChatWithSingleActionLabel={resolveCommentsSidebarSingleChatWithLabel}
            commentChatWith={commentsSidebarCommentChatWith}
          />
        </div>
      );
    }

    return (
      <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]">
        {list}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-overflow-hidden tw-rounded-[var(--radius-outer)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]">
      <aside
        className={[
          'tw-flex tw-min-h-0 tw-w-[min(420px,40%)] tw-min-w-[320px] tw-flex-col tw-bg-[var(--bg-primary)]',
          columnDividerRightClassName(),
        ].join(' ')}
      >
        {list}
      </aside>
      <main className="route-scroll tw-min-h-0 tw-flex-1 tw-bg-[var(--bg-card)] tw-overflow-auto tw-overflow-x-hidden">
        <ConversationDetailPane />
      </main>
    </div>
  );
}
