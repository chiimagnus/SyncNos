import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeNativeHostConnectedCommand } from '../../../packages/syncnoscli/src/native-host/dispatcher';
import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerArticleCommentsHandlers } from '@services/comments/background/handlers';
import { createNativeArticleCommentsRepository } from '@services/comments/data/storage-native';
import { ArticleCommentInvariantError } from '@services/comments/domain/comment-errors';
import {
  LOCAL_DATA_PROTOCOL_VERSION,
  LOCAL_DATA_SCHEMA_VERSION,
  LocalDataContractError,
  parseHostFactsRequest,
} from '@services/local-data/contracts';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';

import { createSqliteTestFixture } from '../../syncnoscli/sqlite-test-fixture';

const commentStorageMocks = vi.hoisted(() => ({ create: vi.fn() }));
const sharedStorageMocks = vi.hoisted(() => ({ get: vi.fn(async () => ({})) }));

vi.mock('@services/comments/data/storage', async (importOriginal) => ({
  ...(await importOriginal()),
  createArticleCommentsRepository: commentStorageMocks.create,
}));

vi.mock('@services/shared/storage', () => ({ storageGet: sharedStorageMocks.get }));

const nativeEpoch = 'native:550e8400-e29b-41d4-a716-446655440000' as const;
const articleUrl = 'https://example.com/article';
const article = {
  id: 7,
  source: 'web',
  conversationKey: 'article:https://example.com/article',
  sourceType: 'article',
  url: articleUrl,
};
const comment = {
  id: 17,
  parentId: null,
  conversationId: article.id,
  canonicalUrl: articleUrl,
  authorName: 'Alice',
  quoteText: 'quote',
  commentText: 'comment',
  locator: null,
  createdAt: 1,
  updatedAt: 1,
};
const context = {
  canonicalUrl: articleUrl,
  conversation: { source: article.source, conversationKey: article.conversationKey, conversationId: article.id },
};
const locator = {
  v: 1 as const,
  env: 'app' as const,
  quote: { type: 'TextQuoteSelector' as const, exact: 'quote' },
  position: { type: 'TextPositionSelector' as const, start: 0, end: 5 },
};
const fixture = createSqliteTestFixture('syncnoscli-comments-native-routing-');

function browserContext() {
  return {
    canonicalUrl: articleUrl,
    conversation: { source: article.source, conversationKey: article.conversationKey },
  };
}

function hostRequest(command: string, payload: Record<string, unknown>) {
  return parseHostFactsRequest({
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    requestId: `comments-${command.toLowerCase()}`,
    command,
    payload,
  });
}

afterEach(async () => {
  commentStorageMocks.create.mockReset();
  sharedStorageMocks.get.mockReset();
  sharedStorageMocks.get.mockResolvedValue({});
  vi.restoreAllMocks();
  await fixture.cleanup();
});

describe('native article comments repository', () => {
  it('maps only re-resolved Host ids and preserves comment invariant errors', async () => {
    const calls: Array<{ command: string; payload: Record<string, unknown> }> = [];
    const connectNative = vi.fn(async ({ command, payload }: any) => {
      calls.push({ command, payload });
      switch (command) {
        case 'LIST_ARTICLE_COMMENTS':
          return [comment];
        case 'ADD_ARTICLE_COMMENT':
          return comment;
        case 'ADD_ARTICLE_COMMENT_REPLY':
          return { kind: 'article-comment-invariant', code: 'parent_not_root' };
        case 'DELETE_ARTICLE_COMMENT':
          return { ok: true };
        case 'ENSURE_ARTICLE_COMMENT_CONTEXT':
          return { updated: 2 };
        case 'MIGRATE_ARTICLE_COMMENT_URL':
          return { updated: 1 };
        default:
          throw new Error(`unexpected ${command}`);
      }
    });
    const gate = new FactsOperationGate({
      readJournal: async () => ({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null }),
    });
    await gate.initializeFromJournal();

    await gate.runFactsOperation('comments-native-routing', async (lease) => {
      const repository = createNativeArticleCommentsRepository(lease, { connectNative });
      await expect(repository.list({ context, fallbackPolicy: 'include-orphan-url' })).resolves.toEqual([comment]);
      await expect(
        repository.addRoot({ context, authorName: 'Alice', quoteText: 'quote', commentText: 'comment', locator }),
      ).resolves.toEqual(comment);
      await expect(
        repository.addReply({ context, authorName: 'Alice', commentText: 'reply', parentId: comment.id }),
      ).rejects.toEqual(expect.objectContaining({ name: 'ArticleCommentInvariantError', code: 'parent_not_root' }));
      await expect(repository.delete({ context, commentId: comment.id })).resolves.toBe(true);
      await expect(repository.ensureContext({ context })).resolves.toEqual({ updated: 2 });
      await expect(
        repository.migrateCanonicalUrl({
          context,
          fromCanonicalUrl: articleUrl,
          toCanonicalUrl: 'https://example.com/new',
        }),
      ).resolves.toEqual({ updated: 1 });
    });

    expect(calls.map((call) => call.command)).toEqual([
      'LIST_ARTICLE_COMMENTS',
      'ADD_ARTICLE_COMMENT',
      'ADD_ARTICLE_COMMENT_REPLY',
      'DELETE_ARTICLE_COMMENT',
      'ENSURE_ARTICLE_COMMENT_CONTEXT',
      'MIGRATE_ARTICLE_COMMENT_URL',
    ]);
    expect(calls[0].payload).toEqual({
      context: {
        canonicalUrl: articleUrl,
        conversation: {
          source: article.source,
          conversationKey: article.conversationKey,
          backendConversationId: article.id,
        },
      },
      fallbackPolicy: 'include-orphan-url',
    });
    expect(calls[2].payload).toEqual({
      context: calls[0].payload.context,
      authorName: 'Alice',
      commentText: 'reply',
      backendParentId: comment.id,
    });
    expect(calls[1].payload).toEqual(
      expect.objectContaining({ context: calls[0].payload.context, locator, quoteText: 'quote' }),
    );
    expect(calls[3].payload).toEqual({ context: calls[0].payload.context, backendCommentId: comment.id });
    expect(calls[5].payload).toEqual({
      conversation: {
        source: article.source,
        conversationKey: article.conversationKey,
        backendConversationId: article.id,
      },
      fromCanonicalUrl: articleUrl,
      toCanonicalUrl: 'https://example.com/new',
    });
    for (const call of calls) expect(JSON.stringify(call.payload)).not.toContain('factsEpoch');
  });
});

describe('article comments background handlers', () => {
  function createHarness() {
    const factsRepository = {
      getConversationByReference: vi.fn(async () => article),
    };
    const commentsRepository = {
      list: vi.fn(async () => [comment]),
      addRoot: vi.fn(async () => comment),
      addReply: vi.fn(async () => comment),
      delete: vi.fn(async () => true),
      ensureContext: vi.fn(async () => ({ updated: 0 })),
      migrateCanonicalUrl: vi.fn(async () => ({ updated: 0 })),
    };
    const order: string[] = [];
    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    router.eventsHub.broadcast = () => order.push('broadcast');
    registerArticleCommentsHandlers(router as any, {
      conversationReadRunner: {
        run: async ({ expectedFactsEpoch, read }: any) => {
          if (expectedFactsEpoch !== nativeEpoch) throw new LocalDataContractError('STALE_BACKEND_EPOCH');
          const result = await read({
            factsEpoch: nativeEpoch,
            mode: 'native',
            lease: {},
            repository: factsRepository,
          });
          order.push('lease-release');
          return result;
        },
      },
      onConversationChanged: async () => order.push('autosync'),
    });
    commentStorageMocks.create.mockReturnValue(commentsRepository);
    return { commentsRepository, factsRepository, order, router };
  }

  it('rejects stale epoch and legacy numeric context before comment or conversation lookup', async () => {
    const { commentsRepository, factsRepository, order, router } = createHarness();
    sharedStorageMocks.get.mockClear();
    const stale = await router.__handleMessageForTests({
      type: 'deleteArticleComment',
      factsEpoch: 'idb-v1',
      context: browserContext(),
      commentId: comment.id,
    });
    expect(stale).toMatchObject({ ok: false, error: { extra: { code: 'STALE_BACKEND_EPOCH' } } });

    const staleRoot = await router.__handleMessageForTests({
      type: 'addArticleComment',
      factsEpoch: 'idb-v1',
      context: browserContext(),
      quoteText: '',
      commentText: 'root',
    });
    expect(staleRoot).toMatchObject({ ok: false, error: { extra: { code: 'STALE_BACKEND_EPOCH' } } });

    const legacy = await router.__handleMessageForTests({
      type: 'deleteArticleComment',
      factsEpoch: nativeEpoch,
      context: {
        canonicalUrl: articleUrl,
        conversation: { source: article.source, conversationKey: article.conversationKey, conversationId: article.id },
      },
      commentId: comment.id,
    });
    expect(legacy).toMatchObject({ ok: false, error: { extra: { code: 'INVALID_ARGUMENT' } } });
    expect(factsRepository.getConversationByReference).not.toHaveBeenCalled();
    expect(commentsRepository.delete).not.toHaveBeenCalled();
    expect(sharedStorageMocks.get).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('re-resolves the article before numeric delete, waits for auto-sync, then broadcasts', async () => {
    const { commentsRepository, factsRepository, order, router } = createHarness();
    commentsRepository.delete.mockImplementation(async () => {
      order.push('delete');
      return true;
    });

    const response = await router.__handleMessageForTests({
      type: 'deleteArticleComment',
      factsEpoch: nativeEpoch,
      context: browserContext(),
      commentId: comment.id,
    });

    expect(response).toMatchObject({ ok: true, data: { ok: true } });
    expect(commentStorageMocks.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'native' }));
    expect(factsRepository.getConversationByReference).toHaveBeenCalledWith({
      source: article.source,
      conversationKey: article.conversationKey,
    });
    expect(commentsRepository.delete).toHaveBeenCalledWith({
      context,
      commentId: comment.id,
    });
    expect(order).toEqual(['delete', 'autosync', 'lease-release', 'broadcast']);
  });

  it('rejects a resolved URL mismatch before a numeric comment operation', async () => {
    const { commentsRepository, factsRepository, router } = createHarness();
    factsRepository.getConversationByReference.mockResolvedValue({ ...article, url: 'https://example.com/replaced' });

    const response = await router.__handleMessageForTests({
      type: 'deleteArticleComment',
      factsEpoch: nativeEpoch,
      context: browserContext(),
      commentId: comment.id,
    });

    expect(response).toMatchObject({ ok: false, error: { extra: { code: 'STALE_REFERENCE' } } });
    expect(commentsRepository.delete).not.toHaveBeenCalled();
  });

  it('maps the shared comment invariant error without broadcasting', async () => {
    const { commentsRepository, order, router } = createHarness();
    commentsRepository.addReply.mockRejectedValue(new ArticleCommentInvariantError('parent_not_root'));

    const response = await router.__handleMessageForTests({
      type: 'addArticleCommentReply',
      factsEpoch: nativeEpoch,
      context: browserContext(),
      parentId: comment.id,
      commentText: 'reply',
    });

    expect(response).toMatchObject({ ok: false, error: { message: 'parent_not_root' } });
    expect(order).toEqual([]);
  });
});

describe('Native Host article comments commands', () => {
  it('rejects a stale comment handle when the old numeric conversation id now belongs to a replacement row', async () => {
    const { comments, conversations, database } = await fixture.open();
    const oldArticle = conversations.upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:old-owner',
      title: 'Old owner',
      url: articleUrl,
      lastCapturedAt: 1,
    });
    const oldContext = {
      canonicalUrl: articleUrl,
      conversation: {
        source: 'web',
        conversationKey: oldArticle.conversationKey,
        backendConversationId: oldArticle.id,
      },
    };
    const root = writeNativeHostConnectedCommand(
      database,
      hostRequest('ADD_ARTICLE_COMMENT', {
        context: oldContext,
        authorName: 'Alice',
        quoteText: '',
        commentText: 'old comment',
      }),
    ) as { id: number };

    expect(conversations.deleteConversationsByIds([oldArticle.id])).toMatchObject({ deletedConversations: 1 });
    database
      .prepare(
        `INSERT INTO conversations (
          id, source, conversation_key, source_type, title, url, last_captured_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        oldArticle.id,
        'gemini',
        'replacement-row',
        'chat',
        'Replacement row',
        'https://example.com/replacement',
        2,
        JSON.stringify({ source: 'gemini', conversationKey: 'replacement-row', title: 'Replacement row' }),
      );

    expect(() =>
      writeNativeHostConnectedCommand(
        database,
        hostRequest('DELETE_ARTICLE_COMMENT', {
          context: oldContext,
          backendCommentId: root.id,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'STALE_REFERENCE' }));
    expect(comments.listArticleCommentsByCanonicalUrl(articleUrl).map((item) => item.id)).toContain(root.id);
  });

  it('resolves context before delete and attaches orphan comments through the typed Host command', async () => {
    const { comments, conversations, database } = await fixture.open();
    const storedArticle = conversations.upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:host-routing',
      title: 'Article',
      url: articleUrl,
      lastCapturedAt: 1,
    });
    const hostContext = {
      canonicalUrl: articleUrl,
      conversation: {
        source: 'web',
        conversationKey: storedArticle.conversationKey,
        backendConversationId: storedArticle.id,
      },
    };
    const orphan = writeNativeHostConnectedCommand(
      database,
      hostRequest('ADD_ARTICLE_COMMENT', {
        context: { canonicalUrl: articleUrl },
        authorName: 'Alice',
        quoteText: 'quote',
        commentText: 'orphan',
      }),
    ) as { id: number };
    const attached = writeNativeHostConnectedCommand(
      database,
      hostRequest('ENSURE_ARTICLE_COMMENT_CONTEXT', { context: hostContext }),
    );
    expect(attached).toEqual({ updated: 1 });
    const root = writeNativeHostConnectedCommand(
      database,
      hostRequest('ADD_ARTICLE_COMMENT', {
        context: hostContext,
        authorName: 'Alice',
        quoteText: '',
        commentText: 'root',
      }),
    ) as { id: number };
    const reply = writeNativeHostConnectedCommand(
      database,
      hostRequest('ADD_ARTICLE_COMMENT_REPLY', {
        context: hostContext,
        authorName: 'Alice',
        commentText: 'reply',
        backendParentId: root.id,
      }),
    ) as { id: number; parentId: number | null };
    expect(reply.parentId).toBe(root.id);

    let deleteError: unknown = null;
    try {
      writeNativeHostConnectedCommand(
        database,
        hostRequest('DELETE_ARTICLE_COMMENT', {
          context: { ...hostContext, canonicalUrl: 'https://example.com/replaced' },
          backendCommentId: root.id,
        }),
      );
    } catch (error) {
      deleteError = error;
    }
    expect(deleteError).toMatchObject({ code: 'STALE_REFERENCE' });
    expect(comments.listArticleCommentsByCanonicalUrl(articleUrl).map((item) => item.id)).toContain(orphan.id);
    expect(comments.listArticleCommentsByCanonicalUrl(articleUrl).map((item) => item.id)).toContain(root.id);
  });
});
