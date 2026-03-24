import { useEffect, useMemo, useRef, useState } from 'react';

import {
  addArticleComment,
  deleteArticleCommentById,
  listArticleCommentsByCanonicalUrl,
} from '@services/comments/client/repo';
import {
  mountThreadedCommentsPanel,
  type ThreadedCommentsPanelApi,
  type ThreadedCommentItem,
} from '@services/comments/threaded-comments-panel';
import type { CommentSidebarSession } from '@services/comments/sidebar/comment-sidebar-contract';

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
  sidebarSession,
  conversationId,
  canonicalUrl,
  quoteText,
  focusComposerSignal,
  containerClassName,
  variant,
  onRequestClose,
}: {
  sidebarSession?: CommentSidebarSession;
  conversationId: number;
  canonicalUrl: string;
  quoteText?: string;
  focusComposerSignal?: number;
  containerClassName?: string;
  variant?: 'embedded' | 'sidebar';
  onRequestClose?: () => void;
}) {
  if (sidebarSession) {
    return (
      <ArticleCommentsSidebarMount
        sidebarSession={sidebarSession}
        containerClassName={containerClassName}
        variant={variant}
        onRequestClose={onRequestClose}
      />
    );
  }

  return (
    <ArticleCommentsEmbedded
      conversationId={conversationId}
      canonicalUrl={canonicalUrl}
      quoteText={quoteText}
      focusComposerSignal={focusComposerSignal}
      containerClassName={containerClassName}
      variant={variant}
      onRequestClose={onRequestClose}
    />
  );
}

function ArticleCommentsSidebarMount({
  sidebarSession,
  containerClassName,
  variant,
  onRequestClose,
}: {
  sidebarSession: CommentSidebarSession;
  containerClassName?: string;
  variant?: 'embedded' | 'sidebar';
  onRequestClose?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<ThreadedCommentsPanelApi | null>(null);
  const canClose = typeof onRequestClose === 'function';

  useEffect(() => {
    if (!hostRef.current) return;
    if (apiRef.current) return;
    const host = hostRef.current;

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      variant: variant === 'sidebar' ? 'sidebar' : 'embedded',
      showHeader: true,
      showCollapseButton: canClose,
      surfaceBg: 'var(--bg-primary)',
    });
    apiRef.current = mounted.api;
    sidebarSession.attachPanel(mounted.api as any);

    return () => {
      sidebarSession.detachPanel();
      mounted.cleanup();
      apiRef.current = null;
    };
  }, [canClose, sidebarSession, variant]);

  const sectionClassName = [containerClassName || '', 'tw-flex tw-min-h-0 tw-flex-col'].filter(Boolean).join(' ');

  return (
    <section className={sectionClassName}>
      <div ref={hostRef} className="tw-min-h-0 tw-flex-1" />
    </section>
  );
}

function ArticleCommentsEmbedded({
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
    if (!hostRef.current) return;
    if (apiRef.current) return;
    const host = hostRef.current;

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      variant: variant === 'sidebar' ? 'sidebar' : 'embedded',
      showHeader: true,
      showCollapseButton: canClose,
      surfaceBg: 'var(--bg-primary)',
    });
    apiRef.current = mounted.api;

    mounted.api.setQuoteText(String(quoteTextRef.current || ''));
    mounted.api.setHandlers({
      onClose: () => {
        onRequestCloseRef.current?.();
      },
      onSave: async (text: string) => {
        if (!normalizedUrl) return false;
        const value = String(text || '').trim();
        if (!value) return false;
        const quoteValue = String(quoteTextRef.current || '');
        try {
          mounted.api.setBusy(true);
          await addArticleComment({
            canonicalUrl: normalizedUrl,
            conversationId: Number(conversationId) > 0 ? Number(conversationId) : null,
            parentId: null,
            quoteText: quoteValue,
            commentText: value,
          } as any);
          await refresh();
          quoteTextRef.current = '';
          mounted.api.setQuoteText('');
          return true;
        } finally {
          mounted.api.setBusy(false);
        }
      },
      onReply: async (parentId: number, text: string) => {
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
      onDelete: async (id: number) => {
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
    } as any);

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
    if (!api) return;
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
          authorName: c?.authorName != null ? String(c.authorName) : null,
          createdAt: Number(c?.createdAt) || null,
          quoteText: String(c?.quoteText || ''),
          commentText: String(c?.commentText || ''),
        }),
      ),
    );
  }, [items]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.setBusy(loading);
  }, [loading]);

  const sectionClassName = [containerClassName || '', 'tw-flex tw-min-h-0 tw-flex-col'].filter(Boolean).join(' ');

  return (
    <section className={sectionClassName}>
      {error ? <p className="tw-mb-2 tw-text-xs tw-font-semibold tw-text-[var(--error)]">{error}</p> : null}
      <div ref={hostRef} className="tw-min-h-0 tw-flex-1" />
    </section>
  );
}
