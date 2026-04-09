import { t } from '@i18n';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import {
  resolvePendingFocusTarget,
  resolveTargetRootIdForReply,
  resolveTargetRootIdFromSaveResult,
} from './focus-rules';
import type { ThreadedCommentsPanelProps } from './types';

function compareCommentTimeDesc(
  a: { createdAt?: number | null; id: number },
  b: { createdAt?: number | null; id: number },
): number {
  const ta = Number(a?.createdAt) || 0;
  const tb = Number(b?.createdAt) || 0;
  if (tb !== ta) return tb - ta;
  return Number(b?.id || 0) - Number(a?.id || 0);
}

function compareCommentTimeAsc(
  a: { createdAt?: number | null; id: number },
  b: { createdAt?: number | null; id: number },
): number {
  const ta = Number(a?.createdAt) || 0;
  const tb = Number(b?.createdAt) || 0;
  if (ta !== tb) return ta - tb;
  return Number(a?.id || 0) - Number(b?.id || 0);
}

function formatTime(ts: number | null | undefined): string {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    return new Date(value).toLocaleString();
  } catch (_error) {
    return '';
  }
}

export function ThreadedCommentsPanel({
  variant,
  fullWidth,
  showHeader,
  showCollapseButton,
  showHeaderChatWith,
  snapshot,
  readHandlers,
  onRequestClose,
  onHeaderChatWithRootChange,
  setPendingFocusRootId,
  locateThreadRoot,
  onLocateFailed,
  commentChatWith,
  showNotice,
}: ThreadedCommentsPanelProps) {
  const [composerText, setComposerText] = useState('');
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});
  const [armedDeleteId, setArmedDeleteId] = useState<number | null>(null);
  const armedDeleteIdRef = useRef<number | null>(null);
  const [openCommentChatWithRootId, setOpenCommentChatWithRootId] = useState<number | null>(null);
  const [commentChatWithMenus, setCommentChatWithMenus] = useState<
    Record<
      number,
      {
        actions: {
          id: string;
          label: string;
          disabled?: boolean;
          onTrigger?: () => void | string | Promise<void | string>;
        }[];
      }
    >
  >({});
  const [localBusyCount, setLocalBusyCount] = useState(0);
  const actionInFlightRef = useRef(false);
  const unmountedRef = useRef(false);
  const commentChatWithLoadingRef = useRef<Record<number, boolean>>({});
  const commentChatWithRequestIdRef = useRef<Record<number, number>>({});
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerTextRef = useRef('');
  const lastFocusedComposerSignalRef = useRef(0);
  const lastHandledEscapeSignalRef = useRef(0);
  const lastComposerPointerDownAtRef = useRef(0);
  const lastComposerAutoSelectionRequestAtRef = useRef(0);
  const replyTextareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const replyTextsRef = useRef<Record<number, string>>({});
  const pendingReplyFocusRootIdRef = useRef<number | null>(null);
  const externallyBusy = snapshot.busy === true;
  const busy = externallyBusy || localBusyCount > 0;

  const headerChatWithRootRef = useCallback(
    (el: HTMLDivElement | null) => {
      onHeaderChatWithRootChange?.(el);
    },
    [onHeaderChatWithRootChange],
  );

  const syncLocalState = useCallback((run: () => void) => {
    try {
      flushSync(run);
    } catch (_error) {
      run();
    }
  }, []);

  const autosizeTextarea = (textarea: HTMLTextAreaElement | null | undefined) => {
    if (!textarea) return;
    try {
      textarea.style.overflowY = 'hidden';
      textarea.style.height = '0px';
      const next = Math.max(0, Number(textarea.scrollHeight || 0) || 0);
      textarea.style.height = `${next}px`;
    } catch (_error) {
      // ignore
    }
  };

  const focusComposer = () => {
    const node = composerTextareaRef.current;
    if (!node) return;
    try {
      node.focus();
      const value = String(node.value || '');
      node.setSelectionRange(value.length, value.length);
    } catch (_error) {
      // ignore
    }
  };

  const setPanelTooltip = (el: HTMLElement, label: string) => {
    const text = String(label || '').trim();
    if (!text) {
      el.removeAttribute('data-webclipper-tooltip');
      return;
    }
    el.setAttribute('data-webclipper-tooltip', text);
  };

  const runBusyTask = async (task: () => Promise<void>) => {
    if (unmountedRef.current) return false;
    if (actionInFlightRef.current) return false;
    actionInFlightRef.current = true;
    setLocalBusyCount((count) => count + 1);
    try {
      await task();
      return true;
    } finally {
      actionInFlightRef.current = false;
      if (!unmountedRef.current) {
        setLocalBusyCount((count) => Math.max(0, count - 1));
      }
    }
  };

  const setCommentChatWithLoading = (rootId: number, loading: boolean) => {
    if (!Number.isFinite(rootId) || rootId <= 0) return;
    const key = Math.round(rootId);
    if (loading) {
      commentChatWithLoadingRef.current[key] = true;
      return;
    }
    delete commentChatWithLoadingRef.current[key];
  };

  const nextCommentChatWithRequestId = (rootId: number): number => {
    const key = Math.round(rootId);
    const next = Number(commentChatWithRequestIdRef.current[key] || 0) + 1;
    commentChatWithRequestIdRef.current[key] = next;
    return next;
  };

  const isCommentChatWithRequestCurrent = (rootId: number, requestId: number): boolean => {
    if (unmountedRef.current) return false;
    return Number(commentChatWithRequestIdRef.current[Math.round(rootId)] || 0) === Number(requestId);
  };

  const updateComposerText = (value: string) => {
    const next = String(value || '');
    composerTextRef.current = next;
    syncLocalState(() => {
      setComposerText(next);
    });
  };

  const updateReplyText = (rootId: number, value: string) => {
    const next = String(value || '');
    replyTextsRef.current = { ...replyTextsRef.current, [rootId]: next };
    syncLocalState(() => {
      setReplyText(rootId, next);
    });
  };

  const requestComposerSelection = (trigger: 'button' | 'auto') => {
    if (trigger === 'auto') {
      const now = Date.now();
      if (now - Number(lastComposerAutoSelectionRequestAtRef.current || 0) <= 120) return;
      lastComposerAutoSelectionRequestAtRef.current = now;
    }
    const latestHandlers = readHandlers?.() || snapshot.handlers;
    const handler = latestHandlers.onComposerSelectionRequest;
    if (typeof handler !== 'function') return;
    void Promise.resolve(handler({ trigger })).catch(() => {
      // ignore
    });
  };

  const updateArmedDeleteId = useCallback(
    (next: number | null) => {
      armedDeleteIdRef.current = next;
      syncLocalState(() => {
        setArmedDeleteId(next);
      });
    },
    [syncLocalState],
  );

  const submitComposer = async (rawText?: string | null) => {
    const text = String(rawText ?? composerTextareaRef.current?.value ?? composerTextRef.current ?? '').trim();
    if (!text || busy || actionInFlightRef.current) return;
    const latestHandlers = readHandlers?.() || snapshot.handlers;
    const onSave = latestHandlers.onSave;
    if (typeof onSave !== 'function') return;
    await runBusyTask(async () => {
      const result = await onSave(text);
      if (unmountedRef.current) return;
      const createdRootId = resolveTargetRootIdFromSaveResult(result);
      if (createdRootId != null) {
        pendingReplyFocusRootIdRef.current = createdRootId;
        setPendingFocusRootId?.(createdRootId);
      }
      composerTextRef.current = '';
      setComposerText('');
      try {
        if (composerTextareaRef.current) {
          composerTextareaRef.current.value = '';
          autosizeTextarea(composerTextareaRef.current);
        }
      } catch (_error) {
        // ignore
      }
    });
  };

  useLayoutEffect(() => {
    autosizeTextarea(composerTextareaRef.current);
  }, [composerText]);

  useLayoutEffect(() => {
    const signal = Number(snapshot.focusComposerSignal || 0);
    if (!Number.isFinite(signal) || signal <= 0) return;
    if (signal <= lastFocusedComposerSignalRef.current) return;
    if (busy) return;
    focusComposer();
    lastFocusedComposerSignalRef.current = signal;
  }, [busy, snapshot.focusComposerSignal]);

  useLayoutEffect(() => {
    const signal = Number(snapshot.escapeSignal || 0);
    if (!Number.isFinite(signal) || signal <= 0) return;
    if (signal <= lastHandledEscapeSignalRef.current) return;
    lastHandledEscapeSignalRef.current = signal;
    if (openCommentChatWithRootId != null) {
      setOpenCommentChatWithRootId(null);
      return;
    }
    updateArmedDeleteId(null);
  }, [openCommentChatWithRootId, snapshot.escapeSignal, updateArmedDeleteId]);

  const normalizedItems = Array.isArray(snapshot.comments)
    ? snapshot.comments.filter((item) => Number.isFinite(Number(item?.id)))
    : [];
  const roots = normalizedItems.filter((item) => !item.parentId).sort(compareCommentTimeDesc);
  const rootIdSet = useMemo(() => new Set(roots.map((item) => Number(item.id))), [roots]);
  const repliesByRoot = new Map<number, typeof normalizedItems>();
  for (const item of normalizedItems) {
    if (!item?.parentId) continue;
    const rootId = Number(item.parentId);
    const list = repliesByRoot.get(rootId) || [];
    list.push(item);
    repliesByRoot.set(rootId, list);
  }
  for (const [rootId, list] of repliesByRoot) {
    repliesByRoot.set(rootId, list.sort(compareCommentTimeAsc));
  }

  const setReplyText = (rootId: number, value: string) => {
    setReplyTexts((prev) => {
      if ((prev[rootId] || '') === value) return prev;
      const next = { ...prev, [rootId]: value };
      replyTextsRef.current = next;
      return next;
    });
  };

  const submitReply = async (rootId: number, rawText?: string | null) => {
    const latestHandlers = readHandlers?.() || snapshot.handlers;
    const onReply = latestHandlers.onReply;
    if (typeof onReply !== 'function') return;
    const text = String(
      rawText ?? replyTextareaRefs.current[rootId]?.value ?? replyTextsRef.current[rootId] ?? '',
    ).trim();
    if (!text || busy || actionInFlightRef.current) return;
    await runBusyTask(async () => {
      await onReply(rootId, text);
      if (unmountedRef.current) return;
      replyTextsRef.current = { ...replyTextsRef.current, [rootId]: '' };
      setReplyText(rootId, '');
      const targetRootId = resolveTargetRootIdForReply(rootId);
      if (targetRootId == null) return;
      pendingReplyFocusRootIdRef.current = targetRootId;
      setPendingFocusRootId?.(targetRootId);
    });
  };

  const shouldIgnoreLocateClick = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
    try {
      if (el.isContentEditable) return true;
      if (el.closest('button,input,textarea,a,label,select,option')) return true;
    } catch (_error) {
      // ignore
    }
    return false;
  };

  const runLocate = async (rootId: number) => {
    if (busy || variant !== 'sidebar') return;
    if (typeof locateThreadRoot !== 'function') return;
    const ok = await locateThreadRoot(rootId);
    if (!ok) onLocateFailed?.();
  };

  useLayoutEffect(() => {
    const allowPendingFocusWhenRequested =
      snapshot.hasFocusWithinPanel || snapshot.pendingFocusRootId != null || pendingReplyFocusRootIdRef.current != null;
    const rootId = resolvePendingFocusTarget({
      pendingFocusRootId: snapshot.pendingFocusRootId,
      fallbackPendingFocusRootId: pendingReplyFocusRootIdRef.current,
      hasFocusWithinPanel: allowPendingFocusWhenRequested,
      existingRootIds: rootIdSet,
    });
    if (rootId == null) return;
    const target = replyTextareaRefs.current[rootId] || null;
    if (!target) return;
    try {
      target.focus();
      const value = String(target.value || '');
      target.setSelectionRange(value.length, value.length);
    } catch (_error) {
      // ignore
    }
    try {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (_error) {
      // ignore
    }
    pendingReplyFocusRootIdRef.current = null;
    setPendingFocusRootId?.(null);
  }, [rootIdSet, setPendingFocusRootId, snapshot.hasFocusWithinPanel, snapshot.pendingFocusRootId, snapshot.comments]);

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
    if (externallyBusy || actionInFlightRef.current) return;
    if (!Number.isFinite(id) || id <= 0) return;
    if (armedDeleteIdRef.current !== id) {
      updateArmedDeleteId(id);
      return;
    }
    updateArmedDeleteId(null);
    const latestHandlers = readHandlers?.() || snapshot.handlers;
    const onDelete = latestHandlers.onDelete;
    if (typeof onDelete !== 'function') return;
    await runBusyTask(async () => {
      await onDelete(id);
    });
  };

  const normalizeCommentChatWithActions = (input: unknown[]) => {
    if (!Array.isArray(input)) return [];
    const out: {
      id: string;
      label: string;
      disabled?: boolean;
      onTrigger?: () => void | string | Promise<void | string>;
    }[] = [];
    for (const item of input) {
      const candidate = item as any;
      const id = String(candidate?.id || '').trim();
      const label = String(candidate?.label || '').trim();
      if (!id || !label || typeof candidate?.onTrigger !== 'function') continue;
      out.push({
        id,
        label,
        disabled: Boolean(candidate?.disabled),
        onTrigger: candidate?.onTrigger,
      });
    }
    return out;
  };

  const toggleCommentChatWithMenu = async (rootId: number) => {
    if (busy) return;
    if (!commentChatWith || typeof commentChatWith.resolveActions !== 'function') return;
    if (commentChatWithLoadingRef.current[Math.round(rootId)]) return;
    if (openCommentChatWithRootId === rootId) {
      syncLocalState(() => {
        setOpenCommentChatWithRootId(null);
      });
      return;
    }
    const rootComment = roots.find((item) => Number(item.id) === rootId);
    if (!rootComment) return;
    setCommentChatWithLoading(rootId, true);
    const requestId = nextCommentChatWithRequestId(rootId);
    try {
      const replies = repliesByRoot.get(rootId) || [];
      const context =
        typeof commentChatWith.resolveContext === 'function' ? await commentChatWith.resolveContext() : {};
      const actions = normalizeCommentChatWithActions(
        await commentChatWith.resolveActions(rootComment, context || {}, replies),
      );
      if (!isCommentChatWithRequestCurrent(rootId, requestId)) return;
      if (!actions.length) {
        showNotice?.('No AI platforms enabled');
        syncLocalState(() => {
          setOpenCommentChatWithRootId(null);
        });
        return;
      }
      if (actions.length === 1) {
        try {
          const message = await actions[0].onTrigger?.();
          if (!isCommentChatWithRequestCurrent(rootId, requestId)) return;
          if (message) showNotice?.(String(message));
        } catch (error) {
          if (!isCommentChatWithRequestCurrent(rootId, requestId)) return;
          const msg = error instanceof Error ? error.message : String(error || t('actionFailedFallback'));
          showNotice?.(msg);
        }
        syncLocalState(() => {
          setOpenCommentChatWithRootId(null);
        });
        return;
      }
      syncLocalState(() => {
        setCommentChatWithMenus((prev) => ({ ...prev, [rootId]: { actions } }));
        setOpenCommentChatWithRootId(rootId);
      });
    } catch (error) {
      if (!isCommentChatWithRequestCurrent(rootId, requestId)) return;
      const msg = error instanceof Error ? error.message : String(error || t('actionFailedFallback'));
      showNotice?.(msg);
    } finally {
      if (isCommentChatWithRequestCurrent(rootId, requestId)) {
        setCommentChatWithLoading(rootId, false);
      }
    }
  };

  const triggerCommentChatWithAction = async (rootId: number, actionId: string) => {
    const menu = commentChatWithMenus[rootId];
    const action = menu?.actions.find((item) => item.id === actionId);
    if (!action || action.disabled || busy) return;
    syncLocalState(() => {
      setOpenCommentChatWithRootId(null);
    });
    try {
      const message = await action.onTrigger?.();
      if (message) showNotice?.(String(message));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error || t('actionFailedFallback'));
      showNotice?.(msg);
    }
  };

  useLayoutEffect(() => {
    return () => {
      unmountedRef.current = true;
      commentChatWithLoadingRef.current = {};
      commentChatWithRequestIdRef.current = {};
      onHeaderChatWithRootChange?.(null);
    };
  }, [onHeaderChatWithRootChange]);

  return (
    <div
      className="webclipper-inpage-comments-panel__surface"
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button[data-webclipper-comment-delete-id]')) return;
        if (!target?.closest('.webclipper-inpage-comments-panel__comment-chatwith')) {
          syncLocalState(() => {
            setOpenCommentChatWithRootId(null);
          });
        }
        updateArmedDeleteId(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (openCommentChatWithRootId != null) {
          event.preventDefault();
          syncLocalState(() => {
            setOpenCommentChatWithRootId(null);
          });
          return;
        }
        if (armedDeleteIdRef.current == null) return;
        event.preventDefault();
        updateArmedDeleteId(null);
      }}
    >
      {showHeader ? (
        <div className="webclipper-inpage-comments-panel__header">
          <div className="webclipper-inpage-comments-panel__header-title">{t('articleCommentsHeading')}</div>
          <div className="webclipper-inpage-comments-panel__header-actions">
            {showHeaderChatWith ? (
              <div className="webclipper-inpage-comments-panel__chatwith" ref={headerChatWithRootRef} />
            ) : null}
            {showCollapseButton ? (
              <button
                type="button"
                className="webclipper-inpage-comments-panel__collapse webclipper-btn header-button"
                aria-label={t('closeCommentsSidebar')}
                onClick={() => onRequestClose()}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M6.25 3.25L9.5 6.5L6.25 9.75"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M9.3 6.5H3.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="webclipper-inpage-comments-panel__body">
        <div
          className="webclipper-inpage-comments-panel__notice"
          style={{ display: snapshot.noticeVisible && snapshot.noticeMessage ? 'block' : 'none' }}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {snapshot.noticeMessage}
        </div>
        <div
          className="webclipper-inpage-comments-panel__quote"
          style={{ display: snapshot.quoteText ? 'block' : 'none' }}
        >
          <div className="webclipper-inpage-comments-panel__quote-text">{snapshot.quoteText}</div>
        </div>
        <div className="webclipper-inpage-comments-panel__reply-composer is-root" data-webclipper-root-composer="1">
          <textarea
            ref={composerTextareaRef}
            className="webclipper-inpage-comments-panel__composer-textarea"
            placeholder="Write a comment…"
            rows={1}
            value={composerText}
            onPointerDown={() => {
              lastComposerPointerDownAtRef.current = Date.now();
              requestComposerSelection('auto');
            }}
            onFocus={() => {
              const now = Date.now();
              if (now - Number(lastComposerPointerDownAtRef.current || 0) <= 250) return;
              requestComposerSelection('auto');
            }}
            onInput={(event) => updateComposerText(event.currentTarget.value)}
            onChange={(event) => updateComposerText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.nativeEvent as KeyboardEvent).isComposing) return;
              if (event.key !== 'Enter') return;
              if (!(event.metaKey || event.ctrlKey)) return;
              if (event.shiftKey || event.altKey) return;
              event.preventDefault();
              void submitComposer(event.currentTarget.value);
            }}
            disabled={false}
          />
          <button
            type="button"
            className="webclipper-inpage-comments-panel__send webclipper-btn webclipper-btn--icon"
            aria-label={t('tooltipCommentSendDetailed')}
            disabled={busy || !String(composerText || '').trim()}
            onClick={() => {
              void submitComposer();
            }}
          >
            ↑
          </button>
        </div>
        <div className="webclipper-inpage-comments-panel__threads">
          {roots.length ? (
            roots.map((root) => {
              const rootId = Number(root.id);
              const replies = repliesByRoot.get(rootId) || [];
              return (
                <div
                  key={rootId}
                  className="webclipper-inpage-comments-panel__thread"
                  data-thread-root-id={String(rootId)}
                >
                  {root.quoteText ? (
                    <div
                      className="webclipper-inpage-comments-panel__thread-quote"
                      onClick={(event) => {
                        if (shouldIgnoreLocateClick(event.target)) return;
                        void runLocate(rootId);
                      }}
                    >
                      <div className="webclipper-inpage-comments-panel__thread-quote-text">
                        {String(root.quoteText)}
                      </div>
                    </div>
                  ) : null}

                  <div
                    className="webclipper-inpage-comments-panel__comment"
                    onClick={(event) => {
                      if (shouldIgnoreLocateClick(event.target)) return;
                      void runLocate(rootId);
                    }}
                  >
                    <div className="webclipper-inpage-comments-panel__comment-header">
                      <div className="webclipper-inpage-comments-panel__avatar">You</div>
                      <div className="webclipper-inpage-comments-panel__comment-meta">
                        <div className="webclipper-inpage-comments-panel__comment-author">
                          {String(root.authorName || 'You')}
                        </div>
                        <div className="webclipper-inpage-comments-panel__comment-time">
                          {formatTime(root.createdAt)}
                        </div>
                      </div>
                      <div className="webclipper-inpage-comments-panel__comment-actions">
                        {commentChatWith ? (
                          <div className="webclipper-inpage-comments-panel__comment-chatwith webclipper-inpage-comments-panel__chatwith">
                            <button
                              type="button"
                              className="webclipper-inpage-comments-panel__comment-chatwith-trigger webclipper-inpage-comments-panel__chatwith-trigger webclipper-btn webclipper-btn--tone-muted"
                              aria-haspopup="menu"
                              aria-expanded={openCommentChatWithRootId === rootId ? 'true' : 'false'}
                              disabled={busy || !String(root.commentText || '').trim()}
                              data-base-disabled={String(String(root.commentText || '').trim() ? 0 : 1)}
                              onClick={() => {
                                void toggleCommentChatWithMenu(rootId);
                              }}
                            >
                              {t('detailHeaderChatWithMenuLabel') || 'Chat with...'}
                            </button>
                            <div
                              className="webclipper-inpage-comments-panel__comment-chatwith-menu webclipper-inpage-comments-panel__chatwith-menu"
                              role="menu"
                              aria-label={t('detailHeaderChatWithMenuAria')}
                              hidden={openCommentChatWithRootId !== rootId}
                            >
                              <div className="webclipper-inpage-comments-panel__comment-chatwith-menu-body webclipper-inpage-comments-panel__chatwith-menu-body">
                                {(commentChatWithMenus[rootId]?.actions || []).map((action) => (
                                  <button
                                    key={action.id}
                                    type="button"
                                    className="webclipper-inpage-comments-panel__comment-chatwith-menu-item webclipper-btn webclipper-btn--menu-item"
                                    data-action-disabled={action.disabled ? '1' : '0'}
                                    disabled={busy || Boolean(action.disabled)}
                                    onClick={() => {
                                      void triggerCommentChatWithAction(rootId, action.id);
                                    }}
                                  >
                                    {action.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className={`webclipper-inpage-comments-panel__icon-btn webclipper-btn ${
                            armedDeleteId === rootId
                              ? 'webclipper-btn--danger'
                              : 'webclipper-btn--danger-tint webclipper-btn--icon'
                          }`}
                          data-confirm={armedDeleteId === rootId ? '1' : undefined}
                          data-webclipper-comment-delete-id={String(rootId)}
                          aria-label={t('deleteButton')}
                          onMouseEnter={(event) => {
                            const target = event.currentTarget;
                            setPanelTooltip(
                              target,
                              armedDeleteId === rootId
                                ? t('tooltipDeleteCommentConfirmDetailed')
                                : t('tooltipDeleteCommentDetailed'),
                            );
                          }}
                          onClick={() => {
                            void handleDelete(rootId);
                          }}
                        >
                          {armedDeleteId === rootId ? t('deleteButton') : '×'}
                        </button>
                      </div>
                    </div>
                    <div className="webclipper-inpage-comments-panel__comment-body">
                      {String(root.commentText || '')}
                    </div>
                  </div>

                  {replies.length ? (
                    <div className="webclipper-inpage-comments-panel__replies">
                      {replies.map((reply) => (
                        <div key={reply.id} className="webclipper-inpage-comments-panel__reply">
                          <div className="webclipper-inpage-comments-panel__reply-header">
                            <div className="webclipper-inpage-comments-panel__avatar is-small">You</div>
                            <div className="webclipper-inpage-comments-panel__reply-meta">
                              <div className="webclipper-inpage-comments-panel__comment-author">
                                {String(reply.authorName || 'You')}
                              </div>
                              <div className="webclipper-inpage-comments-panel__comment-time">
                                {formatTime(reply.createdAt)}
                              </div>
                            </div>
                            <div className="webclipper-inpage-comments-panel__comment-actions">
                              <button
                                type="button"
                                className={`webclipper-inpage-comments-panel__icon-btn webclipper-btn ${
                                  armedDeleteId === reply.id
                                    ? 'webclipper-btn--danger'
                                    : 'webclipper-btn--danger-tint webclipper-btn--icon'
                                }`}
                                data-confirm={armedDeleteId === reply.id ? '1' : undefined}
                                data-webclipper-comment-delete-id={String(reply.id)}
                                aria-label={t('deleteButton')}
                                onMouseEnter={(event) => {
                                  const target = event.currentTarget;
                                  setPanelTooltip(
                                    target,
                                    armedDeleteId === reply.id
                                      ? t('tooltipDeleteCommentConfirmDetailed')
                                      : t('tooltipDeleteCommentDetailed'),
                                  );
                                }}
                                onClick={() => {
                                  void handleDelete(reply.id);
                                }}
                              >
                                {armedDeleteId === reply.id ? t('deleteButton') : '×'}
                              </button>
                            </div>
                          </div>
                          <div className="webclipper-inpage-comments-panel__comment-body is-reply">
                            {String(reply.commentText || '')}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="webclipper-inpage-comments-panel__reply-composer">
                    <textarea
                      ref={(el) => {
                        replyTextareaRefs.current[rootId] = el;
                      }}
                      className="webclipper-inpage-comments-panel__reply-textarea"
                      placeholder="Reply…"
                      rows={1}
                      value={replyTexts[rootId] || ''}
                      onInput={(event) => {
                        updateReplyText(rootId, event.currentTarget.value);
                        autosizeTextarea(event.currentTarget);
                      }}
                      onChange={(event) => {
                        updateReplyText(rootId, event.currentTarget.value);
                        autosizeTextarea(event.currentTarget);
                      }}
                      onKeyDown={(event) => {
                        if ((event.nativeEvent as KeyboardEvent).isComposing) return;
                        if (event.key !== 'Enter') return;
                        if (!(event.metaKey || event.ctrlKey)) return;
                        if (event.shiftKey || event.altKey) return;
                        event.preventDefault();
                        void submitReply(rootId, event.currentTarget.value);
                      }}
                      disabled={false}
                    />
                    <button
                      type="button"
                      className="webclipper-inpage-comments-panel__send webclipper-btn webclipper-btn--icon"
                      aria-label={t('tooltipReplySendDetailed')}
                      disabled={busy || !String(replyTexts[rootId] || '').trim()}
                      onClick={() => {
                        void submitReply(rootId);
                      }}
                    >
                      ↑
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="webclipper-inpage-comments-panel__empty">No comments yet</div>
          )}
        </div>
      </div>
      <span style={{ display: 'none' }} data-variant={variant} data-full-width={fullWidth ? '1' : '0'} />
    </div>
  );
}
