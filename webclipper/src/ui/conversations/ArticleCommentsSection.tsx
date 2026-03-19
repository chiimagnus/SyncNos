import { useEffect, useMemo, useState } from 'react';

import { t } from '../../i18n';
import { CONTENT_MESSAGE_TYPES, UI_EVENT_TYPES, UI_PORT_NAMES } from '../../platform/messaging/message-contracts';
import { connectPort } from '../../platform/runtime/ports';
import { deleteArticleCommentById, listArticleCommentsByCanonicalUrl, type ArticleCommentDto } from '../../comments/client/repo';
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

export function ArticleCommentsSection({ conversationId, canonicalUrl }: { conversationId: number; canonicalUrl: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ArticleCommentDto[]>([]);

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

  return (
    <section className="tw-mt-4 tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-3 md:tw-p-4">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <h3 className="tw-m-0 tw-text-[14px] tw-font-extrabold tw-text-[var(--text-primary)]">
          {heading}
        </h3>
        <div className="tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
          {items.length}
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

      <div className="tw-mt-3 tw-grid tw-gap-3">
        {items.map((c) => (
          <div
            key={String(c.id)}
            className="tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-p-3"
            onClick={(e) => {
              const target = e.target as HTMLElement | null;
              if (target?.closest?.('button')) return;
              void locate(c);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              const target = e.target as HTMLElement | null;
              if (target?.closest?.('button')) return;
              e.preventDefault();
              void locate(c);
            }}
          >
            {String(c.quoteText || '').trim() ? (
              <div className="tw-mb-2 tw-rounded-xl tw-border tw-border-[color-mix(in_srgb,var(--border)_55%,#e8c86a)] tw-bg-[rgba(232,200,106,0.18)] tw-p-2.5">
                <div className="tw-whitespace-pre-wrap tw-break-words tw-text-[12px] tw-font-semibold tw-text-[var(--text-primary)]">
                  {c.quoteText}
                </div>
              </div>
            ) : null}

            <div className="tw-flex tw-items-start tw-justify-between tw-gap-2">
              <div className="tw-min-w-0">
                <div className="tw-text-[12px] tw-font-extrabold tw-text-[var(--text-primary)]">You</div>
                <div className="tw-mt-0.5 tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)]">
                  {formatTime(c.createdAt)}
                </div>
              </div>
              <button
                type="button"
                className="tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-transparent tw-px-2 tw-py-1 tw-text-[11px] tw-font-extrabold tw-text-[var(--error)] hover:tw-border-[color-mix(in_srgb,var(--border)_55%,var(--error))]"
                onClick={() => {
                  void (async () => {
                    await deleteArticleCommentById(Number(c.id));
                    await refresh();
                  })();
                }}
              >
                {t('deleteButton')}
              </button>
            </div>

            <div className="tw-mt-2 tw-whitespace-pre-wrap tw-break-words tw-text-[13px] tw-font-semibold tw-text-[var(--text-primary)]">
              {c.commentText}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
