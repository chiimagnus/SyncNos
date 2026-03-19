import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { t } from '../../i18n';
import { CONTENT_MESSAGE_TYPES, UI_EVENT_TYPES, UI_PORT_NAMES } from '../../platform/messaging/message-contracts';
import { connectPort } from '../../platform/runtime/ports';
import {
  addArticleComment,
  deleteArticleCommentById,
  listArticleCommentsByCanonicalUrl,
  type ArticleCommentDto,
} from '../../comments/client/repo';
import { tabsQuery, tabsSendMessage } from '../../platform/webext/tabs';

function formatTime(ts: number | null | undefined): string {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    return new Date(value).toLocaleString();
  } catch (_e) {
    return '';
  }
}

function normalizeHttpUrl(raw: unknown): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = String(url.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

export function ArticleCommentsSection({
  conversationId,
  canonicalUrl,
  headerExtra,
  containerClassName,
}: {
  conversationId: number;
  canonicalUrl: string;
  headerExtra?: ReactNode;
  containerClassName?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ArticleCommentDto[]>([]);
  const [saving, setSaving] = useState(false);
  const [newCommentDraft, setNewCommentDraft] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const normalizedUrl = useMemo(() => normalizeHttpUrl(canonicalUrl), [canonicalUrl]);

  const refresh = async () => {
    if (!normalizedUrl) return;
    setLoading(true);
    setError(null);
    try {
      const next = await listArticleCommentsByCanonicalUrl(normalizedUrl);
      setItems(Array.isArray(next) ? next : []);
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'unknown error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedUrl]);

  useEffect(() => {
    if (!conversationId) return;
    let disposed = false;
    let port: any = null;
    const connect = () => {
      if (disposed) return;
      try {
        port = connectPort(UI_PORT_NAMES.POPUP_EVENTS);
      } catch (_e) {
        port = null;
        return;
      }

      const onMessage = (message: any) => {
        if (disposed) return;
        if (!message || typeof message !== 'object') return;
        if (message.type !== UI_EVENT_TYPES.CONVERSATIONS_CHANGED) return;
        const payload = (message as any).payload || {};
        const changedId = Number(payload.conversationId);
        if (Number.isFinite(changedId) && changedId > 0 && changedId === Number(conversationId)) {
          void refresh();
        }
      };

      const onDisconnect = () => {
        try {
          port?.onMessage?.removeListener?.(onMessage);
        } catch (_e) {
          // ignore
        }
        port = null;
        if (disposed) return;
        setTimeout(connect, 1000);
      };

      try {
        port?.onMessage?.addListener?.(onMessage);
        port?.onDisconnect?.addListener?.(onDisconnect);
      } catch (_e) {
        try {
          port?.disconnect?.();
        } catch (_e2) {
          // ignore
        }
        port = null;
      }
    };

    connect();

    return () => {
      disposed = true;
      try {
        port?.disconnect?.();
      } catch (_e) {
        // ignore
      }
      port = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, normalizedUrl]);

  const heading = t('articleCommentsHeading');
  const locate = async (comment: ArticleCommentDto) => {
    const exact = String(comment?.quoteText || '').trim();
    if (!exact) return;
    const ctx = (comment as any)?.quoteContext || null;
    const selector = {
      exact,
      ...(ctx?.prefix ? { prefix: String(ctx.prefix) } : null),
      ...(ctx?.suffix ? { suffix: String(ctx.suffix) } : null),
    };
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    const tab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
    const tabId = Number((tab as any)?.id);
    if (!tab || !Number.isFinite(tabId) || tabId <= 0) return;
    await tabsSendMessage(tabId, { type: CONTENT_MESSAGE_TYPES.LOCATE_INPAGE_COMMENT_ANCHOR, payload: { selector } } as any);
  };

  const threads = useMemo(() => {
    const normalized = Array.isArray(items) ? items.slice() : [];
    const roots = normalized.filter((c) => !c?.parentId);
    const repliesByRoot = new Map<number, ArticleCommentDto[]>();
    for (const c of normalized) {
      const parentId = c?.parentId != null ? Number(c.parentId) : NaN;
      if (!Number.isFinite(parentId) || parentId <= 0) continue;
      const list = repliesByRoot.get(parentId) || [];
      list.push(c);
      repliesByRoot.set(parentId, list);
    }
    return roots.map((root) => ({
      root,
      replies: repliesByRoot.get(Number(root.id)) || [],
    }));
  }, [items]);

  const onAddRootComment = async () => {
    if (!normalizedUrl) return;
    const text = String(newCommentDraft || '').trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      await addArticleComment({
        canonicalUrl: normalizedUrl,
        conversationId: Number(conversationId) > 0 ? Number(conversationId) : null,
        parentId: null,
        quoteText: '',
        quoteContext: null,
        commentText: text,
      });
      setNewCommentDraft('');
      await refresh();
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const onReply = async (rootId: number) => {
    if (!normalizedUrl) return;
    const key = String(rootId);
    const text = String(replyDrafts[key] || '').trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      await addArticleComment({
        canonicalUrl: normalizedUrl,
        conversationId: Number(conversationId) > 0 ? Number(conversationId) : null,
        parentId: rootId,
        quoteText: '',
        quoteContext: null,
        commentText: text,
      });
      setReplyDrafts((prev) => ({ ...prev, [key]: '' }));
      await refresh();
    } catch (e) {
      setError((e as any)?.message ?? String(e ?? 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className={[
        'tw-mt-4 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-3 md:tw-p-4',
        containerClassName || '',
      ].join(' ')}
    >
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <h3 className="tw-m-0 tw-text-[14px] tw-font-extrabold tw-text-[var(--text-primary)]">
          {heading}
        </h3>
        <div className="tw-flex tw-items-center tw-gap-2">
          {headerExtra ? <div className="tw-flex tw-items-center">{headerExtra}</div> : null}
          <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">{items.length}</div>
        </div>
      </div>

      {loading ? (
        <p className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('loadingDots')}</p>
      ) : null}
      {error ? (
        <p className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--error)]">{error}</p>
      ) : null}

      {!loading && !error && !items.length ? (
        <p className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{t('articleCommentsEmpty')}</p>
      ) : null}

      <div className="tw-mt-3 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-p-3">
        <div className="tw-flex tw-items-start tw-gap-3">
          <div className="tw-flex tw-h-7 tw-w-7 tw-flex-none tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-[color-mix(in_srgb,var(--border)_55%,var(--brand))] tw-bg-[color-mix(in_srgb,var(--brand)_20%,transparent)] tw-text-[10px] tw-font-black tw-text-[var(--text-primary)]">
            You
          </div>
          <div className="tw-min-w-0 tw-flex-1">
            <textarea
              className="tw-min-h-[44px] tw-w-full tw-resize-y tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-transparent tw-px-3 tw-py-2 tw-text-[13px] tw-font-semibold tw-text-[var(--text-primary)] focus:tw-outline-none focus:tw-ring-2 focus:tw-ring-[color-mix(in_srgb,var(--brand)_55%,transparent)]"
              placeholder="Write a comment…"
              disabled={loading || saving}
              value={newCommentDraft}
              onChange={(e) => setNewCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (!(e.metaKey || e.ctrlKey)) return;
                e.preventDefault();
                void onAddRootComment();
              }}
            />
            <div className="tw-mt-2 tw-flex tw-justify-end">
              <button
                type="button"
                disabled={loading || saving || !String(newCommentDraft || '').trim()}
                className="tw-inline-flex tw-h-8 tw-w-8 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-text-[13px] tw-font-black tw-text-[var(--text-primary)] hover:tw-border-[color-mix(in_srgb,var(--border)_55%,var(--brand))] disabled:tw-opacity-50"
                onClick={() => {
                  void onAddRootComment();
                }}
                aria-label="Comment"
                title="Comment"
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="tw-mt-3 tw-grid tw-gap-3">
        {threads.map(({ root, replies }) => (
          <div
            key={String(root.id)}
            className="tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-p-3"
            onClick={(e) => {
              const target = e.target as HTMLElement | null;
              if (target?.closest?.('button,textarea,input')) return;
              void locate(root);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              const target = e.target as HTMLElement | null;
              if (target?.closest?.('button,textarea,input')) return;
              e.preventDefault();
              void locate(root);
            }}
          >
            {String(root.quoteText || '').trim() ? (
              <div className="tw-mb-2 tw-rounded-xl tw-border tw-border-[color-mix(in_srgb,var(--border)_55%,#e8c86a)] tw-bg-[rgba(232,200,106,0.18)] tw-p-2.5">
                <div className="tw-whitespace-pre-wrap tw-break-words tw-text-[12px] tw-font-semibold tw-text-[var(--text-primary)]">
                  {root.quoteText}
                </div>
              </div>
            ) : null}

            <div className="tw-flex tw-items-start tw-justify-between tw-gap-2">
              <div className="tw-min-w-0">
                <div className="tw-text-[12px] tw-font-extrabold tw-text-[var(--text-primary)]">You</div>
                <div className="tw-mt-0.5 tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
                  {formatTime(root.createdAt)}
                </div>
              </div>
              <button
                type="button"
                disabled={loading || saving}
                className="tw-inline-flex tw-h-7 tw-w-7 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-transparent tw-text-[12px] tw-font-black tw-text-[var(--error)] hover:tw-border-[color-mix(in_srgb,var(--border)_55%,var(--error))] disabled:tw-opacity-50"
                onClick={() => {
                  void (async () => {
                    await deleteArticleCommentById(Number(root.id));
                    await refresh();
                  })();
                }}
                aria-label={t('deleteButton')}
                title={t('deleteButton')}
              >
                ×
              </button>
            </div>

            <div className="tw-mt-2 tw-whitespace-pre-wrap tw-break-words tw-text-[13px] tw-font-semibold tw-text-[var(--text-primary)]">
              {root.commentText}
            </div>

            {replies.length ? (
              <div className="tw-mt-3 tw-grid tw-gap-2 tw-border-l-2 tw-border-[color-mix(in_srgb,var(--border)_68%,transparent)] tw-pl-4">
                {replies.map((r) => (
                  <div
                    key={String(r.id)}
                    className="tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-2.5"
                    onClick={(e) => {
                      const target = e.target as HTMLElement | null;
                      if (target?.closest?.('button')) return;
                      void locate(root);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="tw-flex tw-items-start tw-justify-between tw-gap-2">
                      <div className="tw-min-w-0">
                        <div className="tw-text-[12px] tw-font-extrabold tw-text-[var(--text-primary)]">You</div>
                        <div className="tw-mt-0.5 tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
                          {formatTime(r.createdAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={loading || saving}
                        className="tw-inline-flex tw-h-7 tw-w-7 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-transparent tw-text-[12px] tw-font-black tw-text-[var(--error)] hover:tw-border-[color-mix(in_srgb,var(--border)_55%,var(--error))] disabled:tw-opacity-50"
                        onClick={() => {
                          void (async () => {
                            await deleteArticleCommentById(Number(r.id));
                            await refresh();
                          })();
                        }}
                        aria-label={t('deleteButton')}
                        title={t('deleteButton')}
                      >
                        ×
                      </button>
                    </div>
                    <div className="tw-mt-2 tw-whitespace-pre-wrap tw-break-words tw-text-[12px] tw-font-semibold tw-text-[var(--text-primary)]">
                      {r.commentText}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="tw-mt-3 tw-flex tw-items-end tw-gap-2 tw-border-l-2 tw-border-[color-mix(in_srgb,var(--border)_68%,transparent)] tw-pl-4">
              <textarea
                className="tw-min-h-[34px] tw-flex-1 tw-resize-none tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-transparent tw-px-3 tw-py-2 tw-text-[12px] tw-font-semibold tw-text-[var(--text-primary)] focus:tw-outline-none focus:tw-ring-2 focus:tw-ring-[color-mix(in_srgb,var(--brand)_55%,transparent)]"
                placeholder="Reply…"
                disabled={loading || saving}
                value={replyDrafts[String(root.id)] || ''}
                onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [String(root.id)]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  if (!(e.metaKey || e.ctrlKey)) return;
                  e.preventDefault();
                  void onReply(Number(root.id));
                }}
              />
              <button
                type="button"
                disabled={loading || saving || !String(replyDrafts[String(root.id)] || '').trim()}
                className="tw-inline-flex tw-h-8 tw-w-8 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-text-[13px] tw-font-black tw-text-[var(--text-primary)] hover:tw-border-[color-mix(in_srgb,var(--border)_55%,var(--brand))] disabled:tw-opacity-50"
                onClick={() => {
                  void onReply(Number(root.id));
                }}
                aria-label="Reply"
                title="Reply"
              >
                ↑
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
