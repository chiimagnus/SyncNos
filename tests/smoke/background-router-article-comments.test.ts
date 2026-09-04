import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMENTS_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { AUTO_SYNC_CONVERSATION_CHANGED_REASONS } from '@services/sync/auto-sync/auto-sync-keys';

const storageMocks = vi.hoisted(() => ({
  addArticleComment: vi.fn(),
  attachOrphanCommentsToConversation: vi.fn(),
  deleteArticleCommentById: vi.fn(),
  listArticleCommentsByCanonicalUrl: vi.fn(),
  listArticleCommentsByConversationId: vi.fn(),
  migrateArticleCommentsCanonicalUrl: vi.fn(),
}));

vi.mock('@services/comments/data/storage', () => storageMocks);

import { registerArticleCommentsHandlers } from '@services/comments/background/handlers';

type Handler = (message: any) => Promise<any> | any;

function createRouter() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    router: {
      ok: (data: unknown) => ({ ok: true, data, error: null }),
      err: (message: string, extra?: unknown) => ({ ok: false, data: null, error: { message, extra: extra ?? null } }),
      register(type: string, handler: Handler) {
        handlers.set(type, handler);
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('article comments background handler mutation side effects', () => {
  it('returns ok and schedules auto-sync from the committed delete result owner', async () => {
    storageMocks.deleteArticleCommentById.mockResolvedValue({ deleted: true, conversationId: 31 });
    const onConversationChanged = vi.fn();
    const { router, handlers } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    const response = await handlers.get(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT)?.({ id: 7 });

    expect(response).toEqual({ ok: true, data: { ok: true }, error: null });
    expect(storageMocks.deleteArticleCommentById).toHaveBeenCalledWith(7);
    expect(onConversationChanged).toHaveBeenCalledTimes(1);
    expect(onConversationChanged).toHaveBeenCalledWith(
      31,
      AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged,
    );
  });

  it('rejects a fractional delete id before touching storage', async () => {
    const onConversationChanged = vi.fn();
    const { router, handlers } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    const response = await handlers.get(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT)?.({ id: 7.5 });

    expect(response).toEqual({ ok: false, data: null, error: { message: 'invalid id', extra: null } });
    expect(storageMocks.deleteArticleCommentById).not.toHaveBeenCalled();
    expect(onConversationChanged).not.toHaveBeenCalled();
  });

  it('returns ok=false for a missing delete without scheduling auto-sync', async () => {
    storageMocks.deleteArticleCommentById.mockResolvedValue({ deleted: false, conversationId: null });
    const onConversationChanged = vi.fn();
    const { router, handlers } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    const response = await handlers.get(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT)?.({ id: 8 });

    expect(response).toEqual({ ok: true, data: { ok: false }, error: null });
    expect(onConversationChanged).not.toHaveBeenCalled();
  });

  it('does not invent an auto-sync target for a deleted orphan-only comment', async () => {
    storageMocks.deleteArticleCommentById.mockResolvedValue({ deleted: true, conversationId: null });
    const onConversationChanged = vi.fn();
    const { router, handlers } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    const response = await handlers.get(COMMENTS_MESSAGE_TYPES.DELETE_ARTICLE_COMMENT)?.({ id: 9 });

    expect(response).toEqual({ ok: true, data: { ok: true }, error: null });
    expect(onConversationChanged).not.toHaveBeenCalled();
  });

  it('keeps attach updated=0 successful without auto-sync', async () => {
    storageMocks.attachOrphanCommentsToConversation.mockResolvedValue({ updated: 0 });
    const onConversationChanged = vi.fn();
    const { router, handlers } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    const response = await handlers.get(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS)?.({
      canonicalUrl: 'https://example.com/article#fragment',
      conversationId: 21,
    });

    expect(response).toEqual({ ok: true, data: { updated: 0 }, error: null });
    expect(onConversationChanged).not.toHaveBeenCalled();
  });

  it('schedules auto-sync when attach updates rows', async () => {
    storageMocks.attachOrphanCommentsToConversation.mockResolvedValue({ updated: 2 });
    const onConversationChanged = vi.fn();
    const { router, handlers } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    await handlers.get(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS)?.({
      canonicalUrl: 'https://example.com/article',
      conversationId: 21,
    });

    expect(onConversationChanged).toHaveBeenCalledWith(
      21,
      AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged,
    );
  });

  it('keeps migrate updated=0 successful without auto-sync', async () => {
    storageMocks.migrateArticleCommentsCanonicalUrl.mockResolvedValue({ updated: 0 });
    const onConversationChanged = vi.fn();
    const { router, handlers } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    const response = await handlers.get(COMMENTS_MESSAGE_TYPES.MIGRATE_ARTICLE_COMMENTS_CANONICAL_URL)?.({
      fromCanonicalUrl: 'https://example.com/old',
      toCanonicalUrl: 'https://example.com/new',
      conversationId: 22,
    });

    expect(response).toEqual({ ok: true, data: { updated: 0 }, error: null });
    expect(onConversationChanged).not.toHaveBeenCalled();
  });

  it('schedules auto-sync when migrate updates rows', async () => {
    storageMocks.migrateArticleCommentsCanonicalUrl.mockResolvedValue({ updated: 3 });
    const onConversationChanged = vi.fn();
    const { router, handlers } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    await handlers.get(COMMENTS_MESSAGE_TYPES.MIGRATE_ARTICLE_COMMENTS_CANONICAL_URL)?.({
      fromCanonicalUrl: 'https://example.com/old',
      toCanonicalUrl: 'https://example.com/new',
      conversationId: 22,
    });

    expect(onConversationChanged).toHaveBeenCalledWith(
      22,
      AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged,
    );
  });
});
