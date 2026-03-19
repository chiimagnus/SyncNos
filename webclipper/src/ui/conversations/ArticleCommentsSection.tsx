import { useEffect, useMemo, useRef, useState } from 'react';

import { CONTENT_MESSAGE_TYPES, UI_EVENT_TYPES, UI_PORT_NAMES } from '../../platform/messaging/message-contracts';
import { connectPort } from '../../platform/runtime/ports';
import { addArticleComment, deleteArticleCommentById, listArticleCommentsByCanonicalUrl } from '../../comments/client/repo';
import { tabsQuery, tabsSendMessage } from '../../platform/webext/tabs';
import { mountThreadedCommentsPanel, type ThreadedCommentsPanelApi, type ThreadedCommentItem } from '../comments/threaded-comments-panel';

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
  containerClassName,
  onRequestClose,
}: {
  conversationId: number;
  canonicalUrl: string;
  containerClassName?: string;
  onRequestClose?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<ThreadedCommentsPanelApi | null>(null);
  const lastRawItemsRef = useRef<any[]>([]);

  const normalizedUrl = useMemo(() => normalizeHttpUrl(canonicalUrl), [canonicalUrl]);

  const refresh = async () => {
    if (!normalizedUrl) return;
    setLoading(true);
    setError(null);
    try {
      const next = await listArticleCommentsByCanonicalUrl(normalizedUrl);
      const list = Array.isArray(next) ? next : [];
      lastRawItemsRef.current = list;
      setItems(list);
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

  useEffect(() => {
    if (!hostRef.current) return;
    if (apiRef.current) return;
    const host = hostRef.current;

    const mounted = mountThreadedCommentsPanel(host, { overlay: false, title: 'Comments' });
    apiRef.current = mounted.api;
    mounted.api.setQuoteText('');
    mounted.api.setHandlers({
      onClose: () => {
        if (typeof onRequestClose === 'function') onRequestClose();
      },
      onSave: async (text) => {
        if (!normalizedUrl) return;
        const value = String(text || '').trim();
        if (!value) return;
        try {
          mounted.api.setBusy(true);
          await addArticleComment({
            canonicalUrl: normalizedUrl,
            conversationId: Number(conversationId) > 0 ? Number(conversationId) : null,
            parentId: null,
            quoteText: '',
            quoteContext: null,
            commentText: value,
          } as any);
          await refresh();
        } finally {
          mounted.api.setBusy(false);
        }
      },
      onReply: async (parentId, text) => {
        if (!normalizedUrl) return;
        const value = String(text || '').trim();
        if (!value) return;
        try {
          mounted.api.setBusy(true);
          await addArticleComment({
            canonicalUrl: normalizedUrl,
            conversationId: Number(conversationId) > 0 ? Number(conversationId) : null,
            parentId: Number(parentId),
            quoteText: '',
            quoteContext: null,
            commentText: value,
          } as any);
          await refresh();
        } finally {
          mounted.api.setBusy(false);
        }
      },
      onDelete: async (id) => {
        const commentId = Number(id);
        if (!Number.isFinite(commentId) || commentId <= 0) return;
        try {
          mounted.api.setBusy(true);
          await deleteArticleCommentById(commentId);
          await refresh();
        } finally {
          mounted.api.setBusy(false);
        }
      },
      onLocate: async (item) => {
        const raw = lastRawItemsRef.current;
        const parentId = (item as any)?.parentId != null ? Number((item as any).parentId) : null;
        const root = parentId ? raw.find((c) => Number(c?.id) === parentId) ?? null : raw.find((c) => Number(c?.id) === Number(item?.id)) ?? null;
        const exact = String(root?.quoteText || (item as any)?.quoteText || '').trim();
        if (!exact) return;
        const ctx = (root as any)?.quoteContext || (item as any)?.quoteContext || null;
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
      },
    });

    return () => {
      mounted.cleanup();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, normalizedUrl, onRequestClose]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.setComments(
      (Array.isArray(items) ? items : []).map(
        (c: any): ThreadedCommentItem => ({
          id: Number(c?.id),
          parentId: c?.parentId != null ? Number(c.parentId) : null,
          authorName: 'You',
          createdAt: Number(c?.createdAt) || null,
          quoteText: String(c?.quoteText || ''),
          quoteContext: c?.quoteContext ?? null,
          commentText: String(c?.commentText || ''),
        }),
      ),
    );
    api.setBusy(loading);
  }, [items, loading]);

  return (
    <section className={containerClassName || ''}>
      {error ? <p className="tw-mb-2 tw-text-xs tw-font-semibold tw-text-[var(--error)]">{error}</p> : null}
      <div ref={hostRef} />
    </section>
  );
}
