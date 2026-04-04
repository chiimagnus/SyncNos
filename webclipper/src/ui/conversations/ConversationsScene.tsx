import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useIsNarrowScreen } from '@ui/shared/hooks/useIsNarrowScreen';
import { useNarrowListDetailCommentsRoute } from '@ui/shared/hooks/useNarrowListDetailCommentsRoute';
import type { ArticleCommentsSidebarRuntime } from '@viewmodels/comments/useArticleCommentsSidebarRuntime';

import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import type { ThreadedCommentsPanelChatWithAction, ThreadedCommentsPanelCommentChatWithConfig } from '@ui/comments';
import { ConversationDetailPane } from '@ui/conversations/ConversationDetailPane';
import { ConversationListPane } from '@ui/conversations/ConversationListPane';
import { ArticleCommentsSection } from '@ui/conversations/ArticleCommentsSection';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { consumePendingOpenConversation } from '@ui/conversations/pending-open';
import { columnDividerRightClassName } from '@ui/shared/column-styles';
import { CapturedListPaneShell } from '@ui/shared/CapturedListPaneShell';

type NarrowRoute = 'list' | 'detail' | 'comments';

export type ConversationsSceneListShellConfig = {
  rightSlot?: ReactNode;
  belowHeader?: ReactNode;
};

export type ConversationsSceneWideChrome = 'card' | 'none';

export type ConversationsSceneProps = {
  defaultNarrowRoute?: NarrowRoute;
  inlineNarrowDetailHeader?: boolean;
  onPopupNotionSyncStarted?: () => void;
  onOpenInsightsSection?: () => void;
  onOpenSettingsSection?: (section: string) => void;
  commentsSidebarRuntime?: ArticleCommentsSidebarRuntime;
  narrowCommentsOpenSource?: 'popup' | 'app';
  resolveCommentsSidebarChatWithActions?: () => Promise<ThreadedCommentsPanelChatWithAction[]>;
  resolveCommentsSidebarSingleChatWithLabel?: () => Promise<string | null>;
  commentsSidebarCommentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
  listShell?: ConversationsSceneListShellConfig;
  wideDetail?: ReactNode;
  wideHideList?: boolean;
  wideChrome?: ConversationsSceneWideChrome;
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
  inlineNarrowDetailHeader = false,
  onPopupNotionSyncStarted,
  onOpenInsightsSection,
  onOpenSettingsSection,
  commentsSidebarRuntime,
  narrowCommentsOpenSource = 'popup',
  resolveCommentsSidebarChatWithActions,
  resolveCommentsSidebarSingleChatWithLabel,
  commentsSidebarCommentChatWith,
  listShell,
  wideDetail,
  wideHideList = false,
  wideChrome = 'card',
}: ConversationsSceneProps) {
  const isNarrow = useIsNarrowScreen();
  const { selectedConversation, openConversationExternalBySourceKey, openConversationExternalById } =
    useConversationsApp();
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
  const selectedConversationCanonicalUrl = canonicalizeArticleUrl((selectedConversation as any)?.url);
  const canOpenCommentsFromDetail =
    Boolean(commentsSidebarRuntime) &&
    isArticleConversationLike(selectedConversation) &&
    Boolean(selectedConversationCanonicalUrl);

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
    if (!commentsSidebarRuntime) return;
    return commentsSidebarRuntime.subscribeSidebarClose(() => {
      if (isNarrow && narrowRoute === 'comments') returnToDetail();
    });
  }, [commentsSidebarRuntime, isNarrow, narrowRoute, returnToDetail]);

  const listPane = (
    <ConversationListPane
      initialScrollTop={listScrollTop}
      scrollRestoreKey={listRestoreKey}
      onListScrollTopChange={setListScrollTop}
      onPopupNotionSyncStarted={onPopupNotionSyncStarted}
      onOpenConversation={
        isNarrow
          ? () => {
              openDetail();
            }
          : undefined
      }
      onOpenInsightsSection={onOpenInsightsSection}
      onOpenSettingsSection={onOpenSettingsSection}
    />
  );
  const list = listShell ? (
    <CapturedListPaneShell rightSlot={listShell.rightSlot} belowHeader={listShell.belowHeader}>
      {listPane}
    </CapturedListPaneShell>
  ) : (
    listPane
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
            fullWidth
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

  const wideContainerClassName =
    wideChrome === 'none'
      ? 'tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-overflow-hidden tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]'
      : 'tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-overflow-hidden tw-rounded-[var(--radius-outer)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]';

  return (
    <div className={wideContainerClassName}>
      {wideHideList ? null : (
        <aside
          className={[
            'tw-flex tw-min-h-0 tw-w-[min(420px,40%)] tw-min-w-[320px] tw-flex-col tw-bg-[var(--bg-primary)]',
            columnDividerRightClassName(),
          ].join(' ')}
        >
          {list}
        </aside>
      )}
      <main className="route-scroll tw-min-h-0 tw-flex-1 tw-bg-[var(--bg-card)] tw-overflow-auto tw-overflow-x-hidden">
        {wideDetail ?? <ConversationDetailPane />}
      </main>
    </div>
  );
}
