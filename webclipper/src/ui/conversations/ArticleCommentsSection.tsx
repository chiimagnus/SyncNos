import { useEffect, useMemo, useRef, useState } from 'react';

import { UI_EVENT_TYPES, UI_PORT_NAMES } from '../../platform/messaging/message-contracts';
import { connectPort } from '../../platform/runtime/ports';
import { addArticleComment, deleteArticleCommentById, listArticleCommentsByCanonicalUrl } from '@services/comments/client/repo';
import { mountThreadedCommentsPanel, type ThreadedCommentsPanelApi, type ThreadedCommentItem } from '@services/comments/threaded-comments-panel';

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
  quoteText,
  focusComposerSignal,
  containerClassName,
  variant,
  onRequestClose,
}: {
  conversationId: number;
  canonicalUrl: string;
  quoteText?: string;
  focusComposerSignal?: number;
  containerClassName?: string;
  variant?: 'embedded' | 'sidebar';
  onRequestClose?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<ThreadedCommentsPanelApi | null>(null);
  const quoteTextRef = useRef<string>(String(quoteText || ''));
  quoteTextRef.current = String(quoteText || '');
  const onRequestCloseRef = useRef<(() => void) | undefined>(onRequestClose);
  onRequestCloseRef.current = onRequestClose;
  const focusSignal = Number(focusComposerSignal || 0);
  const lastFocusSignalRef = useRef<number>(0);
  const pendingFocusRef = useRef<boolean>(false);

  const normalizedUrl = useMemo(() => normalizeHttpUrl(canonicalUrl), [canonicalUrl]);
  const canClose = typeof onRequestClose === 'function';

  const refresh = async () => {
    if (!normalizedUrl) return;
    setLoading(true);
    setError(null);
    try {
      const next = await listArticleCommentsByCanonicalUrl(normalizedUrl);
      const list = Array.isArray(next) ? next : [];
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

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      variant: variant === 'sidebar' ? 'sidebar' : 'embedded',
      showHeader: true,
      showCollapseButton: canClose,
    });
    apiRef.current = mounted.api;
    mounted.api.setQuoteText(String(quoteTextRef.current || ''));
    mounted.api.setHandlers({
      onClose: () => {
        onRequestCloseRef.current?.();
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
            quoteText: String(quoteTextRef.current || ''),
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
    });

    mounted.api.setComments(
      (Array.isArray(items) ? items : []).map(
        (c: any): ThreadedCommentItem => ({
          id: Number(c?.id),
          parentId: c?.parentId != null ? Number(c.parentId) : null,
          authorName: 'You',
          createdAt: Number(c?.createdAt) || null,
          quoteText: String(c?.quoteText || ''),
          commentText: String(c?.commentText || ''),
        }),
      ),
    );
    mounted.api.setBusy(loading);

    if (pendingFocusRef.current || focusSignal > 0) {
      pendingFocusRef.current = false;
      mounted.api.open({ focusComposer: true });
    }

    return () => {
      mounted.cleanup();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, normalizedUrl, canClose]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.setQuoteText(String(quoteTextRef.current || ''));
  }, [quoteText]);

  useEffect(() => {
    const api = apiRef.current;
    if (!focusSignal) return;
    if (lastFocusSignalRef.current === focusSignal) return;
    lastFocusSignalRef.current = focusSignal;
    if (!api) {
      pendingFocusRef.current = true;
      return;
    }
    api.open({ focusComposer: true });
  }, [focusSignal]);

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
          commentText: String(c?.commentText || ''),
        }),
      ),
    );
    api.setBusy(loading);
  }, [items, loading]);

  const sectionClassName = [containerClassName || '', 'tw-flex tw-min-h-0 tw-flex-col'].filter(Boolean).join(' ');

  return (
    <section className={sectionClassName}>
      {error ? <p className="tw-mb-2 tw-text-xs tw-font-semibold tw-text-[var(--error)]">{error}</p> : null}
      <div ref={hostRef} className="tw-min-h-0 tw-flex-1" />
    </section>
  );
}
