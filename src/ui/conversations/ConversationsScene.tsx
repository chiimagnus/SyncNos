import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useIsNarrowScreen } from '@ui/shared/hooks/useIsNarrowScreen';
import { useNarrowListDetailCommentsRoute } from '@ui/shared/hooks/useNarrowListDetailCommentsRoute';
import type { ArticleCommentsSidebarRuntime } from '@viewmodels/comments/useArticleCommentsSidebarRuntime';

import { canonicalizeArticleUrl, sanitizeHttpUrl } from '@services/url-cleaning/http-url';
import { t, formatConversationTitle } from '@i18n';
import type { CommentLocatorSurfaceRoots } from '@ui/comments';
import { ConversationListPane } from '@ui/conversations/ConversationListPane';
import { LazyArticleCommentsSection, LazyConversationDetailPane } from '@ui/conversations/LazyConversationSurfaces';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { useInAppShortcuts } from '@viewmodels/shortcuts/useInAppShortcuts';
import { consumePendingOpenConversation } from '@ui/conversations/pending-open';
import { CapturedListPaneShell } from '@ui/shared/CapturedListPaneShell';
import { conversationKinds } from '@services/protocols/conversation-kinds';
import type { SyncProvider } from '@services/sync/models';

type NarrowRoute = 'list' | 'detail' | 'comments';

type ConversationsSceneListShellConfig = {
  rightSlot: ReactNode;
};

type ConversationsSceneWideChrome = 'card' | 'none';

type ConversationsSceneProps = {
  defaultNarrowRoute?: NarrowRoute;
  onPopupSyncPreparing?: (provider: SyncProvider, handoffIds?: readonly number[]) => void | Promise<void>;
  onOpenInsightsSection?: () => void;
  onOpenSettingsSection?: (section: string) => void;
  onOpenCommentsExternally?: () => void;
  commentsSidebarRuntime?: ArticleCommentsSidebarRuntime;
  getCommentsLocatorSurfaceRoots?: () => CommentLocatorSurfaceRoots | null;
  subscribeCommentsLocatorSurfaceRoots?: (listener: () => void) => () => void;
  onCommentsLocatorSurfaceRootsChange?: (roots: CommentLocatorSurfaceRoots | null) => void;
  narrowCommentsOpenSource?: 'popup' | 'app';
  listShell?: ConversationsSceneListShellConfig;
  wideDetail?: ReactNode;
  wideHideList?: boolean;
  wideChrome?: ConversationsSceneWideChrome;
};

export function ConversationsScene({
  defaultNarrowRoute = 'list',
  onPopupSyncPreparing,
  onOpenInsightsSection,
  onOpenSettingsSection,
  onOpenCommentsExternally,
  commentsSidebarRuntime,
  getCommentsLocatorSurfaceRoots,
  subscribeCommentsLocatorSurfaceRoots,
  onCommentsLocatorSurfaceRootsChange,
  narrowCommentsOpenSource = 'popup',
  listShell,
  wideDetail,
  wideHideList = false,
  wideChrome = 'card',
}: ConversationsSceneProps) {
  const isNarrow = useIsNarrowScreen();
  const {
    selectedConversation,
    activeId,
    items,
    exporting,
    deleting,
    copyConversationMarkdown,
    copyConversationSourceLink,
    exportConversationMarkdown,
    deleteConversation,
    detailHeaderActions,
    openConversationExternalBySourceKey,
    openConversationExternalById,
    setDetailSurfaceActive,
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
  const detailSurfaceVisible = !isNarrow || narrowRoute === 'detail';
  const shortcutBusyRef = useRef(false);
  const shortcutTarget = () => {
    const list = document.querySelector<HTMLElement>('[data-conversation-list-pane]');
    const focused = document.activeElement;
    const listFocused = focused instanceof Element && !!list?.contains(focused);
    const listIsActive = isNarrow ? narrowRoute === 'list' : listFocused || !selectedConversation;
    const focusedId =
      listFocused && focused instanceof Element
        ? Number(focused.closest<HTMLElement>('[data-conversation-id]')?.dataset.conversationId)
        : 0;
    const id = listIsActive ? focusedId || Number(activeId) : Number(selectedConversation?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const item = items.find((entry) => Number(entry.id) === id) || selectedConversation;
    if (!item || Number(item.id) !== id) return null;
    return { id, listIsActive, item };
  };
  const runShortcut = (operation: () => Promise<void>) => {
    if (shortcutBusyRef.current) return false;
    shortcutBusyRef.current = true;
    void Promise.resolve()
      .then(operation)
      .catch((error: unknown) => {
        window.alert(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        shortcutBusyRef.current = false;
      });
    return true;
  };
  useInAppShortcuts({
    'copy-markdown': () => {
      const target = shortcutTarget();
      if (!target) return false;
      if (target.listIsActive) return runShortcut(() => copyConversationMarkdown(target.id));
      const action = detailHeaderActions?.find((entry) => entry.id === 'copy-full-markdown' && !entry.disabled);
      return action ? runShortcut(() => action.onTrigger()) : false;
    },
    'copy-list-link': () => {
      const target = shortcutTarget();
      if (!target || !sanitizeHttpUrl(target.item.url)) return false;
      return runShortcut(() => copyConversationSourceLink(target.id));
    },
    'export-item': () => {
      const target = shortcutTarget();
      return target && !exporting && !deleting ? runShortcut(() => exportConversationMarkdown(target.id)) : false;
    },
    'delete-item': () => {
      const target = shortcutTarget();
      if (!target || exporting || deleting || shortcutBusyRef.current) return false;
      if (!window.confirm(t('keyboardShortcutsConfirmDeleteItem') + '\n' + formatConversationTitle(target.item.title)))
        return true;
      return runShortcut(() => deleteConversation(target.id));
    },
  });

  useLayoutEffect(() => {
    setDetailSurfaceActive(detailSurfaceVisible);
    return () => setDetailSurfaceActive(false);
  }, [detailSurfaceVisible, setDetailSurfaceActive]);

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
      onPopupSyncPreparing={onPopupSyncPreparing}
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
    <CapturedListPaneShell rightSlot={listShell.rightSlot}>{listPane}</CapturedListPaneShell>
  ) : (
    listPane
  );

  if (isNarrow) {
    if (narrowRoute === 'detail') {
      return (
        <div className="route-scroll webclipper-detail-route-scroll tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-overflow-auto tw-overflow-x-hidden tw-bg-[var(--bg-card)] tw-text-[var(--text-primary)]">
          <Suspense fallback={null}>
            <LazyConversationDetailPane
              onBack={returnToList}
              onPopupSyncPreparing={onPopupSyncPreparing}
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
          </Suspense>
        </div>
      );
    }

    if (narrowRoute === 'comments' && commentsSidebarRuntime) {
      return (
        <div className="tw-flex tw-h-full tw-min-h-0 tw-w-full tw-min-w-0 tw-flex-col tw-bg-[var(--bg-card)] tw-text-[var(--text-primary)]">
          <Suspense fallback={null}>
            <LazyArticleCommentsSection
              sidebarSession={commentsSidebarRuntime.sidebarSession}
              containerClassName="tw-h-full tw-min-h-0"
              getLocatorSurfaceRoots={() => getCommentsLocatorSurfaceRoots?.() || null}
              subscribeLocatorSurfaceRoots={subscribeCommentsLocatorSurfaceRoots}
              fullWidth
            />
          </Suspense>
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
        <aside className="tw-flex tw-min-h-0 tw-w-[min(360px,40%)] tw-min-w-[320px] tw-flex-col tw-bg-[var(--bg-primary)]">
          {list}
        </aside>
      )}
      <main className="route-scroll webclipper-detail-route-scroll tw-min-h-0 tw-flex-1 tw-bg-[var(--bg-card)] tw-overflow-auto tw-overflow-x-hidden">
        {wideDetail ?? (
          <Suspense fallback={null}>
            <LazyConversationDetailPane onPopupSyncPreparing={onPopupSyncPreparing} />
          </Suspense>
        )}
      </main>
    </div>
  );
}
