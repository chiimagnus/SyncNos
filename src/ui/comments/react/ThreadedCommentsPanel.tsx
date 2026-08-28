import { t } from '@i18n';
import { normalizeCommentThreadGraph } from '@services/comments/domain/comment-thread-graph';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useDiscussionPanel } from '@viewmodels/comments/useDiscussionPanel';
import { flushSync } from 'react-dom';

import { resolveTargetRootIdForReply, resolveTargetRootIdFromSaveResult } from './focus-rules';
import type { ThreadedCommentsPanelProps } from './types';
import { useCommentSelectionAttachment } from './use-comment-selection-attachment';
import { RootCommentComposer } from './RootCommentComposer';
import { CommentQuotePreview } from './CommentQuotePreview';
import { CommentThread } from './CommentThread';
import { ReplyComposer } from './ReplyComposer';
import type { CommentOverflowAction } from './CommentOverflowMenu';
import { useCommentNotice } from './use-comment-notice';
import { useCommentFocusIntent } from './use-comment-focus-intent';
import { CommentsSidebarHeader } from './CommentsSidebarHeader';
import { CommentsPanelState, resolveCommentsPanelVisualState } from './CommentsPanelState';

export function ThreadedCommentsPanel({
  variant,
  fullWidth,
  showHeader,
  showCollapseButton,
  snapshot,
  actions,
  onRequestClose,
  setPendingFocusRootId,
  locateThreadRoot,
  onActiveRootChange,
  onLocateFailed,
  showNotice,
  onNoticeExpired,
}: ThreadedCommentsPanelProps) {
  const discussion = useDiscussionPanel({ snapshot, actions });
  const discussionDispatch = discussion.dispatch;
  const composerText = discussion.state.rootDraft;
  const replyTexts = discussion.state.replyDrafts;
  const armedDeleteId = discussion.state.confirmDelete;
  const panelSurfaceRef = useRef<HTMLDivElement | null>(null);
  const selectionAttachment = useCommentSelectionAttachment({
    open: snapshot.open,
    panelRootRef: panelSurfaceRef,
    requestSelection: (input) => actions.requestComposerSelection(input),
  });
  const unmountedRef = useRef(false);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const replyTextareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const busy = discussion.busy;
  const submitError = discussion.state.submit.status === 'error' ? discussion.state.submit.error : null;

  useLayoutEffect(() => {
    if (submitError) showNotice?.(submitError);
  }, [showNotice, submitError]);

  const syncLocalState = useCallback((run: () => void) => {
    try {
      flushSync(run);
    } catch (_error) {
      run();
    }
  }, []);

  const updateComposerText = (value: string) => {
    syncLocalState(() => discussion.setRootDraft(String(value || '')));
  };

  const updateReplyText = (rootId: number, value: string) => {
    syncLocalState(() => discussion.setReplyDraft(rootId, String(value || '')));
  };

  const updateArmedDeleteId = useCallback((next: number | null) => discussion.setConfirmDelete(next), [discussion]);

  const submitComposer = useCallback(
    async (rawText?: string | null) => {
      const text = String(rawText ?? composerTextareaRef.current?.value ?? composerText ?? '').trim();
      if (!text || busy) return;
      const result = await discussion.submitRoot(text);
      if (unmountedRef.current || result === undefined) return;
      const createdRootId = resolveTargetRootIdFromSaveResult(result);
      if (createdRootId != null) {
        syncLocalState(() => {
          discussion.setActiveRoot(createdRootId);
          discussion.dispatch({ type: 'focus-reply', rootId: createdRootId });
        });
      }
    },
    [busy, composerText, discussion, syncLocalState],
  );

  const normalizedGraph = useMemo(
    () => normalizeCommentThreadGraph(Array.isArray(snapshot.comments) ? snapshot.comments : []),
    [snapshot.comments],
  );
  const roots = useMemo(() => normalizedGraph.threads.map((thread) => thread.root), [normalizedGraph]);
  const panelVisualState = resolveCommentsPanelVisualState({
    loadStatus: snapshot.loadStatus,
    hasComments: roots.length > 0,
  });
  const rootIdSet = useMemo(() => new Set(roots.map((item) => Number(item.id))), [roots]);
  const repliesByRoot = useMemo(
    () => new Map(normalizedGraph.threads.map((thread) => [Number(thread.root.id), thread.replies] as const)),
    [normalizedGraph],
  );
  const commentIds = useMemo(
    () =>
      normalizedGraph.threads.flatMap((thread) => [
        Number(thread.root.id),
        ...thread.replies.map((reply) => Number(reply.id)),
      ]),
    [normalizedGraph],
  );

  useLayoutEffect(() => {
    discussionDispatch({
      type: 'reconcile-threads',
      rootIds: roots.map((root) => Number(root.id)),
      commentIds,
    });
  }, [commentIds, discussionDispatch, roots]);

  const submitReply = useCallback(
    async (rootId: number, rawText?: string | null) => {
      const text = String(rawText ?? replyTextareaRefs.current[rootId]?.value ?? replyTexts[rootId] ?? '').trim();
      if (!text || busy) return;
      await discussion.submitReply(rootId, text);
      if (unmountedRef.current) return;
      const targetRootId = resolveTargetRootIdForReply(rootId);
      if (targetRootId == null) return;
      syncLocalState(() => {
        discussion.dispatch({ type: 'focus-reply', rootId: targetRootId });
      });
    },
    [busy, discussion, replyTexts, syncLocalState],
  );

  const runLocate = async (rootId: number) => {
    if (busy || variant !== 'sidebar') return;
    if (typeof locateThreadRoot !== 'function') return;
    const result = await locateThreadRoot(rootId);
    if (!result.ok && result.reason !== 'aborted') onLocateFailed?.(result.reason);
  };

  useLayoutEffect(() => {
    const onDocumentPointerDown = (event: PointerEvent) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      for (const node of path) {
        const element = node as Element | null;
        if (!element || typeof (element as any).matches !== 'function') continue;
        if ((element as Element).matches('button[data-webclipper-comment-delete-id]')) {
          return;
        }
      }
      updateArmedDeleteId(null);
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    };
  }, [updateArmedDeleteId]);

  const handleDelete = async (id: number) => {
    if (busy) return;
    if (!Number.isFinite(id) || id <= 0) return;
    if (armedDeleteId !== id) {
      updateArmedDeleteId(id);
      return;
    }
    updateArmedDeleteId(null);
    try {
      await discussion.deleteComment(id);
    } catch (error) {
      showNotice?.(error instanceof Error ? error.message : 'Failed to delete comment.');
    }
  };

  useLayoutEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const deleteMenuAction = (id: number): CommentOverflowAction => ({
    id: 'delete',
    label: armedDeleteId === id ? t('deleteButton') : 'Delete',
    destructive: true,
    confirm: armedDeleteId === id,
    dataCommentDeleteId: id,
  });

  const getReplyMenuActions = (reply: { id: number }): CommentOverflowAction[] => [deleteMenuAction(Number(reply.id))];

  const getRootMenuActions = (rootId: number): CommentOverflowAction[] => [deleteMenuAction(rootId)];

  const toggleRootMenu = (root: (typeof roots)[number]) => {
    const rootId = Number(root.id);
    if (discussion.state.openMenu === rootId) {
      discussion.setOpenMenu(null);
      return;
    }
    discussion.setOpenMenu(rootId);
    discussion.dispatch({ type: 'focus-menu', target: rootId });
  };

  const toggleReplyMenu = (id: number) => {
    if (discussion.state.openMenu === id) {
      discussion.setOpenMenu(null);
      return;
    }
    discussion.setOpenMenu(id);
    discussion.dispatch({ type: 'focus-menu', target: id });
  };

  const runMenuAction = async (id: number, action: CommentOverflowAction) => {
    if (action.id !== 'delete') return;
    const wasConfirming = armedDeleteId === id;
    await handleDelete(id);
    if (wasConfirming) discussion.setOpenMenu(null);
  };

  const effectiveActiveRootId = discussion.state.activeRootId ?? (roots.length === 1 ? Number(roots[0]?.id) : null);

  useLayoutEffect(() => {
    onActiveRootChange?.(effectiveActiveRootId);
  }, [effectiveActiveRootId, onActiveRootChange]);

  const focusController = useCommentFocusIntent({
    open: snapshot.open,
    busy,
    focusComposerSignal: snapshot.focusComposerSignal,
    quoteText: snapshot.composerAttachment.displayQuote,
    focusIntent: discussion.state.focusIntent,
    dispatch: discussion.dispatch,
    composerRef: composerTextareaRef,
    replyRefs: replyTextareaRefs,
    pendingFocusRootId: snapshot.pendingFocusRootId,
    rootIds: rootIdSet,
    focusScopeKey: snapshot.comments,
    setPendingFocusRootId,
  });
  const notice = useCommentNotice({
    message: snapshot.noticeMessage,
    visible: snapshot.noticeVisible,
    onExpired: onNoticeExpired,
  });

  return (
    <div
      ref={panelSurfaceRef}
      className="webclipper-inpage-comments-panel__surface"
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button[data-webclipper-comment-delete-id]')) return;
        if (!target?.closest('.webclipper-inpage-comments-panel__overflow')) {
          syncLocalState(() => {
            discussion.setOpenMenu(null);
          });
        }
        updateArmedDeleteId(null);
      }}
    >
      {showHeader ? (
        <CommentsSidebarHeader
          title={t('articleCommentsHeading')}
          showCollapseButton={Boolean(showCollapseButton)}
          collapseLabel={t('closeCommentsSidebar')}
          onCollapse={onRequestClose}
        />
      ) : null}
      <div className="webclipper-inpage-comments-panel__body">
        <div
          className="webclipper-inpage-comments-panel__notice"
          style={{ display: notice.visible ? 'block' : 'none' }}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {notice.message}
        </div>
        <CommentQuotePreview
          variant="composer"
          text={snapshot.composerAttachment.displayQuote}
          onClear={() => {
            selectionAttachment.resetDedupe();
            void Promise.resolve(actions.clearComposerAttachment()).catch(() => {});
          }}
        />
        <RootCommentComposer
          value={composerText}
          disabled={busy}
          textareaRef={composerTextareaRef}
          onChange={updateComposerText}
          onSubmit={(value) => submitComposer(value)}
        />
        <div className="webclipper-inpage-comments-panel__threads" role="list" aria-label="Comment threads">
          <CommentsPanelState state={panelVisualState} error={snapshot.loadError} onRetry={() => actions.retry()}>
            {roots.map((root) => {
              const rootId = Number(root.id);
              const replies = repliesByRoot.get(rootId) || [];
              return (
                <CommentThread
                  key={rootId}
                  root={root}
                  replies={replies}
                  active={effectiveActiveRootId === rootId}
                  busy={busy}
                  openMenuId={typeof discussion.state.openMenu === 'number' ? discussion.state.openMenu : null}
                  rootMenuActions={getRootMenuActions(rootId)}
                  getReplyMenuActions={getReplyMenuActions}
                  quotePreview={
                    <CommentQuotePreview
                      variant="thread"
                      text={String(root.quoteText || '')}
                      invalid={!root.locator}
                      onLocate={() => runLocate(rootId)}
                    />
                  }
                  onActivate={(id) => {
                    syncLocalState(() => {
                      discussion.setActiveRoot(id);
                      discussion.dispatch({ type: 'focus-reply', rootId: id });
                    });
                  }}
                  rootMenuTriggerRef={focusController.registerMenuTrigger(rootId)}
                  getReplyMenuTriggerRef={(replyId) => focusController.registerMenuTrigger(replyId)}
                  onRootMenuToggle={toggleRootMenu}
                  onReplyMenuToggle={toggleReplyMenu}
                  onMenuAction={runMenuAction}
                >
                  {effectiveActiveRootId === rootId ? (
                    <ReplyComposer
                      rootId={rootId}
                      value={replyTexts[rootId] || ''}
                      disabled={busy}
                      textareaRef={(el) => {
                        replyTextareaRefs.current[rootId] = el;
                      }}
                      onChange={(value) => updateReplyText(rootId, value)}
                      onSubmit={(value) => submitReply(rootId, value)}
                      onCancel={() => discussion.setActiveRoot(null)}
                    />
                  ) : null}
                </CommentThread>
              );
            })}
          </CommentsPanelState>
        </div>
      </div>
      <span style={{ display: 'none' }} data-variant={variant} data-full-width={fullWidth ? '1' : '0'} />
    </div>
  );
}
