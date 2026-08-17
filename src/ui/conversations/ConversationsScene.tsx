import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useIsNarrowScreen } from '@ui/shared/hooks/useIsNarrowScreen';
import { useNarrowListDetailCommentsRoute } from '@ui/shared/hooks/useNarrowListDetailCommentsRoute';
import type { ArticleCommentsSidebarRuntime } from '@viewmodels/comments/useArticleCommentsSidebarRuntime';

import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';
import type {
  CommentLocatorSurfaceRoots,
  ThreadedCommentsPanelChatWithAction,
  ThreadedCommentsPanelCommentChatWithConfig,
} from '@ui/comments';
import { ConversationDetailPane } from '@ui/conversations/ConversationDetailPane';
import { ConversationListPane } from '@ui/conversations/ConversationListPane';
import { ConversationSearchSheet } from '@ui/conversations/ConversationSearchSheet';
import { ArticleCommentsSection } from '@ui/conversations/ArticleCommentsSection';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { consumePendingOpenConversation } from '@ui/conversations/pending-open';
import { columnDividerRightClassName } from '@ui/shared/column-styles';
import { CapturedListPaneShell } from '@ui/shared/CapturedListPaneShell';
import { conversationKinds } from '@services/protocols/conversation-kinds';

type NarrowRoute = 'list' | 'detail' | 'comments';

export type ConversationsSceneListShellConfig = {
  rightSlot?: ReactNode;
  belowHeader?: ReactNode;
};

export type ConversationsSceneWideChrome = 'card' | 'none';

export type ConversationsSceneProps = {
  defaultNarrowRoute?: NarrowRoute;
  onPopupNotionSyncStarted?: () => void;
  onPopupFeishuSyncStarted?: () => void;
  onOpenInsightsSection?: () => void;
  onOpenSettingsSection?: (section: string) => void;
  onOpenCommentsExternally?: () => void;
  commentsSidebarRuntime?: ArticleCommentsSidebarRuntime;
  getCommentsLocatorSurfaceRoots?: () => CommentLocatorSurfaceRoots | null;
  subscribeCommentsLocatorSurfaceRoots?: (listener: () => void) => () => void;
  onCommentsLocatorSurfaceRootsChange?: (roots: CommentLocatorSurfaceRoots | null) => void;
  narrowCommentsOpenSource?: 'popup' | 'app';
  resolveCommentsSidebarChatWithActions?: () => Promise<ThreadedCommentsPanelChatWithAction[]>;
  resolveCommentsSidebarSingleChatWithLabel?: () => Promise<string | null>;
  commentsSidebarCommentChatWith?: ThreadedCommentsPanelCommentChatWithConfig | null;
  listShell?: ConversationsSceneListShellConfig;
  wideDetail?: ReactNode;
  wideHideList?: boolean;
  wideChrome?: ConversationsSceneWideChrome;
};

export function ConversationsScene({
  defaultNarrowRoute = 'list',
  onPopupNotionSyncStarted,
  onPopupFeishuSyncStarted,
  onOpenInsightsSection,
  onOpenSettingsSection,
  onOpenCommentsExternally,
  commentsSidebarRuntime,
  getCommentsLocatorSurfaceRoots,
  subscribeCommentsLocatorSurfaceRoots,
  onCommentsLocatorSurfaceRootsChange,
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
  const {
    selectedConversation,
    openConversationExternalBySourceKey,
    openConversationExternalById,
    localSearchSheet,
    listFacets,
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
  const selectedConversationView = conversationKinds.pick(selectedConversation as any)?.view ?? null;
  const commentsSidebarEnabled = Boolean(selectedConversationView?.commentsSidebar);
  const selectedConversationCanonicalUrl = canonicalizeArticleUrl((selectedConversation as any)?.url);
  const canOpenCommentsFromDetail =
    (typeof onOpenCommentsExternally === 'function' || Boolean(commentsSidebarRuntime)) &&
    commentsSidebarEnabled &&
    Boolean(selectedConversationCanonicalUrl);
  const searchSheetVisible = localSearchSheet.capabilityLoading || localSearchSheet.mode !== 'closed';

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
      onPopupFeishuSyncStarted={onPopupFeishuSyncStarted}
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

  let sceneRootClassName: string;
  let underlyingScene: ReactNode;

  if (isNarrow) {
    if (narrowRoute === 'detail') {
      sceneRootClassName =
        'route-scroll webclipper-detail-route-scroll tw-relative tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-overflow-auto tw-overflow-x-hidden tw-bg-[var(--bg-card)] tw-text-[var(--text-primary)]';
      underlyingScene = (
        <ConversationDetailPane
          onBack={returnToList}
          onTriggerCommentsSidebar={
            canOpenCommentsFromDetail
              ? () => {
                  if (typeof onOpenCommentsExternally === 'function') {
                    onOpenCommentsExternally();
                    return;
                  }
                  if (!commentsSidebarRuntime) return;
                  openComments();
                  void commentsSidebarRuntime.sidebarController.open({
                    focusComposer: true,
                    source: narrowCommentsOpenSource,
                    ensureContext: false,
                  });
                }
              : undefined
          }
          onCommentsLocatorRootsChange={(roots) => {
            onCommentsLocatorSurfaceRootsChange?.(roots);
          }}
        />
      );
    } else if (narrowRoute === 'comments' && commentsSidebarRuntime) {
      sceneRootClassName =
        'tw-relative tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-card)] tw-text-[var(--text-primary)]';
      underlyingScene = (
        <ArticleCommentsSection
          sidebarSession={commentsSidebarRuntime.sidebarSession}
          containerClassName="tw-h-full tw-min-h-0"
          getLocatorSurfaceRoots={() => getCommentsLocatorSurfaceRoots?.() || null}
          subscribeLocatorSurfaceRoots={subscribeCommentsLocatorSurfaceRoots}
          resolveChatWithActions={resolveCommentsSidebarChatWithActions}
          resolveChatWithSingleActionLabel={resolveCommentsSidebarSingleChatWithLabel}
          commentChatWith={commentsSidebarCommentChatWith}
          fullWidth
        />
      );
    } else {
      sceneRootClassName =
        'tw-relative tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]';
      underlyingScene = list;
    }
  } else {
    sceneRootClassName =
      wideChrome === 'none'
        ? 'tw-relative tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-overflow-hidden tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]'
        : 'tw-relative tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-overflow-hidden tw-rounded-[var(--radius-outer)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-text-[var(--text-primary)]';

    underlyingScene = (
      <>
        {wideHideList ? null : (
          <aside
            className={[
              'tw-flex tw-min-h-0 tw-w-[min(360px,40%)] tw-min-w-[320px] tw-flex-col tw-bg-[var(--bg-primary)]',
              columnDividerRightClassName(),
            ].join(' ')}
          >
            {list}
          </aside>
        )}
        <main className="route-scroll webclipper-detail-route-scroll tw-min-h-0 tw-flex-1 tw-bg-[var(--bg-card)] tw-overflow-auto tw-overflow-x-hidden">
          {wideDetail ?? <ConversationDetailPane />}
        </main>
      </>
    );
  }

  const openSearchResultAsConversation = async (result: { source: string; conversationKey: string }) => {
    localSearchSheet.close();
    const opened = await openConversationExternalBySourceKey(result.source, result.conversationKey);
    if (opened && isNarrow) openDetail();
  };

  const openLocalDatabaseSettings = () => {
    localSearchSheet.close();
    onOpenSettingsSection?.('backup');
  };

  return (
    <div data-conversations-scene-root="" className={sceneRootClassName}>
      <div
        data-conversations-scene-underlay=""
        className="tw-contents"
        inert={searchSheetVisible ? true : undefined}
        aria-hidden={searchSheetVisible ? true : undefined}
      >
        {underlyingScene}
      </div>
      <div data-conversations-scene-overlay-host="" className="tw-contents">
        {searchSheetVisible ? (
          <ConversationSearchSheet
            controller={localSearchSheet}
            initialFacets={listFacets}
            onClose={localSearchSheet.close}
            onOpenFullConversation={(result) => void openSearchResultAsConversation(result)}
            onOpenSettings={openLocalDatabaseSettings}
          />
        ) : null}
      </div>
    </div>
  );
}
