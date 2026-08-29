import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMENTS_MESSAGE_TYPES, UI_EVENT_TYPES } from '@platform/messaging/message-contracts';
import { AUTO_SYNC_CONVERSATION_CHANGED_REASONS } from '@services/sync/auto-sync/auto-sync-keys';

const storageMocks = vi.hoisted(() => ({
  addArticleComment: vi.fn(),
  attachOrphanCommentsToConversation: vi.fn(),
  deleteArticleCommentById: vi.fn(),
  getArticleCommentDeleteContextById: vi.fn(),
  listArticleCommentsByCanonicalUrl: vi.fn(),
  listArticleCommentsByConversationId: vi.fn(),
  migrateArticleCommentsCanonicalUrl: vi.fn(),
}));

vi.mock('@services/comments/data/storage', () => storageMocks);

import { registerArticleCommentsHandlers } from '@services/comments/background/handlers';

type Handler = (message: any) => Promise<any> | any;

function createRouter() {
  const handlers = new Map<string, Handler>();
  const broadcast = vi.fn();
  return {
    handlers,
    broadcast,
    router: {
      ok: (data: unknown) => ({ ok: true, data, error: null }),
      err: (message: string, extra?: unknown) => ({ ok: false, data: null, error: { message, extra: extra ?? null } }),
      register(type: string, handler: Handler) {
        handlers.set(type, handler);
      },
      eventsHub: { broadcast },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('article comments background handler mutation side effects', () => {
  it('keeps attach updated=0 successful without broadcast or auto-sync', async () => {
    storageMocks.attachOrphanCommentsToConversation.mockResolvedValue({ updated: 0 });
    const onConversationChanged = vi.fn();
    const { router, handlers, broadcast } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    const response = await handlers.get(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS)?.({
      canonicalUrl: 'https://example.com/article#fragment',
      conversationId: 21,
    });

    expect(response).toEqual({ ok: true, data: { updated: 0 }, error: null });
    expect(broadcast).not.toHaveBeenCalled();
    expect(onConversationChanged).not.toHaveBeenCalled();
  });

  it('broadcasts and schedules auto-sync when attach updates rows', async () => {
    storageMocks.attachOrphanCommentsToConversation.mockResolvedValue({ updated: 2 });
    const onConversationChanged = vi.fn();
    const { router, handlers, broadcast } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    await handlers.get(COMMENTS_MESSAGE_TYPES.ATTACH_ORPHAN_ARTICLE_COMMENTS)?.({
      canonicalUrl: 'https://example.com/article',
      conversationId: 21,
    });

    expect(broadcast).toHaveBeenCalledWith(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
      reason: 'articleCommentAttached',
      conversationId: 21,
    });
    expect(onConversationChanged).toHaveBeenCalledWith(
      21,
      AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged,
    );
  });

  it('keeps migrate updated=0 successful without broadcast or auto-sync', async () => {
    storageMocks.migrateArticleCommentsCanonicalUrl.mockResolvedValue({ updated: 0 });
    const onConversationChanged = vi.fn();
    const { router, handlers, broadcast } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    const response = await handlers.get(COMMENTS_MESSAGE_TYPES.MIGRATE_ARTICLE_COMMENTS_CANONICAL_URL)?.({
      fromCanonicalUrl: 'https://example.com/old',
      toCanonicalUrl: 'https://example.com/new',
      conversationId: 22,
    });

    expect(response).toEqual({ ok: true, data: { updated: 0 }, error: null });
    expect(broadcast).not.toHaveBeenCalled();
    expect(onConversationChanged).not.toHaveBeenCalled();
  });

  it('broadcasts and schedules auto-sync when migrate updates rows', async () => {
    storageMocks.migrateArticleCommentsCanonicalUrl.mockResolvedValue({ updated: 3 });
    const onConversationChanged = vi.fn();
    const { router, handlers, broadcast } = createRouter();
    registerArticleCommentsHandlers(router, { onConversationChanged });

    await handlers.get(COMMENTS_MESSAGE_TYPES.MIGRATE_ARTICLE_COMMENTS_CANONICAL_URL)?.({
      fromCanonicalUrl: 'https://example.com/old',
      toCanonicalUrl: 'https://example.com/new',
      conversationId: 22,
    });

    expect(broadcast).toHaveBeenCalledWith(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
      reason: 'articleCommentsMigrated',
      conversationId: 22,
      fromCanonicalUrl: 'https://example.com/old',
      toCanonicalUrl: 'https://example.com/new',
    });
    expect(onConversationChanged).toHaveBeenCalledWith(
      22,
      AUTO_SYNC_CONVERSATION_CHANGED_REASONS.articleCommentChanged,
    );
  });
});
