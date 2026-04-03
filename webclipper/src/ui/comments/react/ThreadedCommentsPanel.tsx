import { t } from '@i18n';
import { useEffect, useMemo, useRef, useState } from 'react';

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
  const [openCommentChatWithRootId, setOpenCommentChatWithRootId] = useState<number | null>(null);
  const [commentChatWithMenus, setCommentChatWithMenus] = useState<
    Record<number, { actions: { id: string; label: string; disabled?: boolean; onTrigger?: () => void | string | Promise<void | string> }[] }>
  >({});
  const [localBusyCount, setLocalBusyCount] = useState(0);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastFocusedComposerSignalRef = useRef(0);
  const replyTextareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const pendingReplyFocusRootIdRef = useRef<number | null>(null);
  const busy = snapshot.busy || localBusyCount > 0;

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
    setLocalBusyCount((count) => count + 1);
    try {
      await task();
    } finally {
      setLocalBusyCount((count) => Math.max(0, count - 1));
    }
  };

  const submitComposer = async () => {
    const text = String(composerText || '').trim();
    if (!text || busy) return;
    const onSave = snapshot.handlers.onSave;
    if (typeof onSave !== 'function') return;
    await runBusyTask(async () => {
      const result = await onSave(text);
      const createdRootId = Number((result as any)?.createdRootId);
      if (Number.isFinite(createdRootId) && createdRootId > 0) {
        pendingReplyFocusRootIdRef.current = Math.round(createdRootId);
        setPendingFocusRootId?.(Math.round(createdRootId));
      }
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

  useEffect(() => {
    autosizeTextarea(composerTextareaRef.current);
  }, [composerText]);

  useEffect(() => {
    const signal = Number(snapshot.focusComposerSignal || 0);
    if (!Number.isFinite(signal) || signal <= 0) return;
    if (signal <= lastFocusedComposerSignalRef.current) return;
    if (busy) return;
    focusComposer();
    lastFocusedComposerSignalRef.current = signal;
  }, [busy, snapshot.focusComposerSignal]);

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
      return { ...prev, [rootId]: value };
    });
  };

  const submitReply = async (rootId: number) => {
    const onReply = snapshot.handlers.onReply;
    if (typeof onReply !== 'function') return;
    const text = String(replyTexts[rootId] || '').trim();
    if (!text || busy) return;
    await runBusyTask(async () => {
      await onReply(rootId, text);
      setReplyText(rootId, '');
      pendingReplyFocusRootIdRef.current = rootId;
      setPendingFocusRootId?.(rootId);
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

  useEffect(() => {
    const rootId = Number(snapshot.pendingFocusRootId || pendingReplyFocusRootIdRef.current || 0);
    if (!Number.isFinite(rootId) || rootId <= 0) return;
    if (!snapshot.hasFocusWithinPanel) return;
    if (!rootIdSet.has(rootId)) return;
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

  useEffect(() => {
    const onDocumentPointerDown = () => {
      setArmedDeleteId(null);
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    };
  }, []);

  const handleDelete = async (id: number) => {
    if (busy) return;
    if (!Number.isFinite(id) || id <= 0) return;
    if (armedDeleteId !== id) {
      setArmedDeleteId(id);
      return;
    }
    setArmedDeleteId(null);
    const onDelete = snapshot.handlers.onDelete;
    if (typeof onDelete !== 'function') return;
    await runBusyTask(async () => {
      await onDelete(id);
    });
  };

  const normalizeCommentChatWithActions = (input: unknown[]) => {
    if (!Array.isArray(input)) return [];
    const out: { id: string; label: string; disabled?: boolean; onTrigger?: () => void | string | Promise<void | string> }[] = [];
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
    if (openCommentChatWithRootId === rootId) {
      setOpenCommentChatWithRootId(null);
      return;
    }
    const rootComment = roots.find((item) => Number(item.id) === rootId);
    if (!rootComment) return;
    const replies = repliesByRoot.get(rootId) || [];
    const context =
      typeof commentChatWith.resolveContext === 'function' ? await commentChatWith.resolveContext() : {};
    const actions = normalizeCommentChatWithActions(
      await commentChatWith.resolveActions(rootComment, context || {}, replies),
    );
    if (!actions.length) {
      showNotice?.('No AI platforms enabled');
      setOpenCommentChatWithRootId(null);
      return;
    }
    if (actions.length === 1) {
      try {
        const message = await actions[0].onTrigger?.();
        if (message) showNotice?.(String(message));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error || t('actionFailedFallback'));
        showNotice?.(msg);
      }
      setOpenCommentChatWithRootId(null);
      return;
    }
    setCommentChatWithMenus((prev) => ({ ...prev, [rootId]: { actions } }));
    setOpenCommentChatWithRootId(rootId);
  };

  const triggerCommentChatWithAction = async (rootId: number, actionId: string) => {
    const menu = commentChatWithMenus[rootId];
    const action = menu?.actions.find((item) => item.id === actionId);
    if (!action || action.disabled || busy) return;
    setOpenCommentChatWithRootId(null);
    try {
      const message = await action.onTrigger?.();
      if (message) showNotice?.(String(message));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error || t('actionFailedFallback'));
      showNotice?.(msg);
    }
  };

  useEffect(() => {
    return () => {
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
          setOpenCommentChatWithRootId(null);
        }
        setArmedDeleteId(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (openCommentChatWithRootId != null) {
          event.preventDefault();
          setOpenCommentChatWithRootId(null);
          return;
        }
        if (armedDeleteId == null) return;
        event.preventDefault();
        setArmedDeleteId(null);
      }}
    >
      {showHeader ? (
        <div className="webclipper-inpage-comments-panel__header">
          <div className="webclipper-inpage-comments-panel__header-title">{t('articleCommentsHeading')}</div>
          <div className="webclipper-inpage-comments-panel__header-actions">
            {showHeaderChatWith ? (
              <div
                className="webclipper-inpage-comments-panel__chatwith"
                ref={(el) => {
                  onHeaderChatWithRootChange?.(el);
                }}
              />
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
        <div className="webclipper-inpage-comments-panel__quote" style={{ display: snapshot.quoteText ? 'block' : 'none' }}>
          <div className="webclipper-inpage-comments-panel__quote-text">{snapshot.quoteText}</div>
        </div>
        <div className="webclipper-inpage-comments-panel__composer">
          <div className="webclipper-inpage-comments-panel__avatar">You</div>
          <div className="webclipper-inpage-comments-panel__composer-main">
            <textarea
              ref={composerTextareaRef}
              className="webclipper-inpage-comments-panel__composer-textarea"
              placeholder="Write a comment…"
              rows={1}
              value={composerText}
              onChange={(event) => setComposerText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if ((event.nativeEvent as KeyboardEvent).isComposing) return;
                if (event.key !== 'Enter') return;
                if (!(event.metaKey || event.ctrlKey)) return;
                if (event.shiftKey || event.altKey) return;
                event.preventDefault();
                void submitComposer();
              }}
              disabled={false}
            />
            <div className="webclipper-inpage-comments-panel__composer-actions">
              <button
                type="button"
                className="webclipper-inpage-comments-panel__send webclipper-btn webclipper-btn--filled webclipper-btn--icon"
                aria-label={t('tooltipCommentSendDetailed')}
                disabled={busy || !String(composerText || '').trim()}
                onClick={() => {
                  void submitComposer();
                }}
              >
                ↑
              </button>
            </div>
          </div>
        </div>
        <div className="webclipper-inpage-comments-panel__threads">
          {roots.length ? (
            roots.map((root) => {
              const rootId = Number(root.id);
              const replies = repliesByRoot.get(rootId) || [];
              return (
                <div key={rootId} className="webclipper-inpage-comments-panel__thread">
                  {root.quoteText ? (
                    <div
                      className="webclipper-inpage-comments-panel__thread-quote"
                      onClick={(event) => {
                        if (shouldIgnoreLocateClick(event.target)) return;
                        void runLocate(rootId);
                      }}
                    >
                      <div className="webclipper-inpage-comments-panel__thread-quote-text">{String(root.quoteText)}</div>
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
                        <div className="webclipper-inpage-comments-panel__comment-time">{formatTime(root.createdAt)}</div>
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
                    <div className="webclipper-inpage-comments-panel__comment-body">{String(root.commentText || '')}</div>
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
                      onChange={(event) => {
                        setReplyText(rootId, event.currentTarget.value);
                        autosizeTextarea(event.currentTarget);
                      }}
                      onKeyDown={(event) => {
                        if ((event.nativeEvent as KeyboardEvent).isComposing) return;
                        if (event.key !== 'Enter') return;
                        if (!(event.metaKey || event.ctrlKey)) return;
                        if (event.shiftKey || event.altKey) return;
                        event.preventDefault();
                        void submitReply(rootId);
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
