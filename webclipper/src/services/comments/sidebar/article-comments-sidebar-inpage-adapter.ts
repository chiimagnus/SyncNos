import { ARTICLE_MESSAGE_TYPES, COMMENTS_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { canonicalizeArticleUrl } from '@services/url-cleaning/http-url';

import type { ArticleCommentsSidebarAdapter } from '@services/comments/sidebar/article-comments-sidebar-adapter';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

function normalizeConversationId(value: unknown): number | null {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function getLocationHrefFallback(): string {
  try {
    return String(globalThis.location?.href || '');
  } catch (_e) {
    return '';
  }
}

export function createArticleCommentsSidebarInpageAdapter(
  runtime: RuntimeClient | null,
): ArticleCommentsSidebarAdapter {
  const rt = runtime;

  return {
    async list({ canonicalUrl }) {
      const normalized = canonicalizeArticleUrl(canonicalUrl);
      if (!normalized) return [];
      if (!rt?.send) return [];
      const res = await rt.send(COMMENTS_MESSAGE_TYPES.LIST_ARTICLE_COMMENTS, { canonicalUrl: normalized } as any);
      if (!res?.ok) return [];
      const items = Array.isArray(res?.data) ? res.data : [];
      return items.map((c: any) => ({
        id: Number(c?.id),
        parentId: c?.parentId != null ? Number(c.parentId) : null,
        authorName: c?.authorName != null ? String(c.authorName) : null,
        createdAt: Number(c?.createdAt) || null,
        quoteText: String(c?.quoteText || ''),
        commentText: String(c?.commentText || ''),
        locator: c?.locator ?? null,
      }));
    },
    async ensureContext(input) {
      const ensureArticle = input?.ensureArticle !== false;
      const fallbackUrl =
        canonicalizeArticleUrl(input?.canonicalUrlFallback) || canonicalizeArticleUrl(getLocationHrefFallback());

      if (!rt?.send || !ensureArticle) {
        return { canonicalUrl: fallbackUrl, conversationId: null };
      }

      const payload = input?.tabId ? { tabId: Number(input.tabId) } : null;
      const res = await rt.send(ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB, payload as any);
      if (!res?.ok) {
        return { canonicalUrl: fallbackUrl, conversationId: null };
      }

      const canonicalUrl = canonicalizeArticleUrl(res?.data?.url) || fallbackUrl;
      const conversationId = normalizeConversationId(res?.data?.conversationId);
      if (canonicalUrl && conversationId) {
        try {
          await rt.send(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS, { canonicalUrl, conversationId } as any);
        } catch (_e) {
          // ignore
        }
      }
      return { canonicalUrl, conversationId };
    },
    async addRoot({ canonicalUrl, conversationId, quoteText, commentText, locator }) {
      const normalized = canonicalizeArticleUrl(canonicalUrl);
      if (!normalized) throw new Error('missing canonicalUrl for adding article comment');
      if (!rt?.send) throw new Error('missing runtime for adding article comment');
      const res = await rt.send(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, {
        canonicalUrl: normalized,
        conversationId,
        quoteText,
        commentText,
        locator: locator ?? null,
      } as any);
      if (!res?.ok) throw new Error('failed to add article comment');
      const id = Number(res?.data?.id);
      if (!Number.isFinite(id) || id <= 0) throw new Error('failed to add article comment');
      return { id };
    },
    async addReply({ canonicalUrl, conversationId, parentId, commentText }) {
      const normalized = canonicalizeArticleUrl(canonicalUrl);
      if (!normalized) throw new Error('missing canonicalUrl for replying article comment');
      if (!rt?.send) throw new Error('missing runtime for replying article comment');
      const res = await rt.send(COMMENTS_MESSAGE_TYPES.ADD_ARTICLE_COMMENT, {
        canonicalUrl: normalized,
        conversationId,
        parentId,
        quoteText: '',
        commentText,
      } as any);
      if (!res?.ok) throw new Error('failed to reply article comment');
    },
    async delete({ id }) {
      if (!rt?.send) throw new Error('missing runtime for deleting article comment');
      const res = await rt.send(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT, { id } as any);
      if (!res?.ok) throw new Error('failed to delete article comment');
    },
    async migrateCanonicalUrl({ fromCanonicalUrl, toCanonicalUrl, conversationId }) {
      const from = canonicalizeArticleUrl(fromCanonicalUrl);
      const to = canonicalizeArticleUrl(toCanonicalUrl);
      if (!from || !to || from === to) return;
      if (!rt?.send) return;
      await rt.send(COMMENTS_MESSAGE_TYPES.MIGRATE_ARTICLE_COMMENTS_CANONICAL_URL, {
        fromCanonicalUrl: from,
        toCanonicalUrl: to,
        conversationId,
      } as any);
    },
  };
}
