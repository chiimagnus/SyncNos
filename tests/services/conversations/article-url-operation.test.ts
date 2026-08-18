import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { DB_NAME } from '@platform/idb/schema';
import { createBackgroundRouter } from '@platform/messaging/background-router';
import { CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { createArticleUrlOperation } from '@services/conversations/data/article-url-operation';
import { createImageStorage } from '@services/conversations/data/image-storage';
import { __closeImageStorageDbForTests } from '@services/conversations/data/image-storage-idb';
import * as conversations from '@services/conversations/data/storage-idb';
import * as comments from '@services/comments/data/storage-idb';
import { assertFactsOperationLease, FactsOperationGate } from '@services/local-data/facts-operation-gate';
import { LocalDataContractError } from '@services/local-data/contracts';

const nativeConnect = vi.hoisted(() => vi.fn());
vi.mock('@platform/local-data/native-client', () => ({
  connectNative: (...args: unknown[]) => nativeConnect(...args),
}));

function article(url: string, title: string) {
  return {
    sourceType: 'article',
    source: 'web',
    conversationKey: `article:${url}`,
    title,
    url,
    lastCapturedAt: Date.now(),
  };
}

async function deleteDatabase() {
  await conversations.__closeDbForTests();
  await comments.__closeDbForTests();
  await __closeImageStorageDbForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('failed to delete test database'));
    request.onblocked = () => reject(new Error('test database delete blocked'));
  });
}

async function runIdbOperation<T>(fn: (lease: Parameters<typeof createArticleUrlOperation>[0]['lease']) => Promise<T>) {
  const gate = new FactsOperationGate({
    readJournal: async () => ({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null }),
  });
  await gate.initializeFromJournal();
  return await gate.runFactsOperation('article-url-test', fn);
}

beforeEach(async () => {
  nativeConnect.mockReset();
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDatabase();
});

afterEach(async () => {
  await deleteDatabase();
  delete (globalThis as any).indexedDB;
  delete (globalThis as any).IDBKeyRange;
});

describe('article URL background operation boundary', () => {
  function createRunner(gate: FactsOperationGate) {
    return {
      run: async ({ kind, expectedFactsEpoch, read }: any) =>
        await gate.runFactsOperation(kind, async (lease) => {
          if (expectedFactsEpoch !== 'idb-v1') throw new LocalDataContractError('STALE_BACKEND_EPOCH');
          return await read({
            lease,
            mode: 'idb',
            factsEpoch: 'idb-v1',
            repository: {
              getConversationByReference: async ({ source, conversationKey }: any) =>
                await conversations.findConversationBySourceAndKey(source, conversationKey),
            },
          });
        }),
    };
  }

  it('awaits auto-sync inside the operation lease and broadcasts exactly once after the compound commit', async () => {
    const from = 'https://example.com/background-from';
    const to = 'https://example.com/background-to';
    const saved = await conversations.upsertConversation(article(from, 'Background'));
    const gate = new FactsOperationGate({
      readJournal: async () => ({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null }),
    });
    await gate.initializeFromJournal();
    const onConversationChanged = vi.fn(async (_reference, _reason, lease) => {
      assertFactsOperationLease(lease);
    });
    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    registerConversationHandlers(router as any, {
      conversationReadRunner: createRunner(gate),
      onConversationChanged,
      streamRouter: { register: () => {} },
    });
    const broadcast = vi.fn();
    router.eventsHub.broadcast = broadcast;

    const response = await router.__handleMessageForTests({
      type: CORE_MESSAGE_TYPES.UPDATE_ARTICLE_URL,
      factsEpoch: 'idb-v1',
      conversation: { source: saved.source, conversationKey: saved.conversationKey },
      fromCanonicalUrl: from,
      toCanonicalUrl: to,
    });

    expect(response).toMatchObject({
      ok: true,
      data: {
        commentsUpdated: 0,
        conversationId: saved.id,
        conversationKey: `article:${to}`,
        source: 'web',
        merged: false,
      },
    });
    expect(onConversationChanged).toHaveBeenCalledTimes(1);
    expect(onConversationChanged.mock.calls[0]?.[0]).toEqual({
      source: 'web',
      conversationKey: `article:${to}`,
      conversationId: saved.id,
    });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0]?.[1]).toMatchObject({ reason: 'articleUrlUpdated', conversationId: saved.id });
  });

  it('keeps an admitted compound URL operation in-flight through awaited auto-sync until migration drain can finish', async () => {
    const from = 'https://example.com/drain-from';
    const to = 'https://example.com/drain-to';
    const saved = await conversations.upsertConversation(article(from, 'Drain'));
    const gate = new FactsOperationGate({
      readJournal: async () => ({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null }),
    });
    await gate.initializeFromJournal();
    let releaseAutoSync!: () => void;
    let enteredAutoSync!: () => void;
    const autoSyncEntered = new Promise<void>((resolve) => {
      enteredAutoSync = resolve;
    });
    const autoSyncRelease = new Promise<void>((resolve) => {
      releaseAutoSync = resolve;
    });
    const onConversationChanged = vi.fn(async (_reference, _reason, lease) => {
      assertFactsOperationLease(lease);
      enteredAutoSync();
      await autoSyncRelease;
      assertFactsOperationLease(lease);
    });
    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    registerConversationHandlers(router as any, {
      conversationReadRunner: createRunner(gate),
      onConversationChanged,
      streamRouter: { register: () => {} },
    });
    const broadcast = vi.fn();
    router.eventsHub.broadcast = broadcast;

    const responsePromise = router.__handleMessageForTests({
      type: CORE_MESSAGE_TYPES.UPDATE_ARTICLE_URL,
      factsEpoch: 'idb-v1',
      conversation: { source: saved.source, conversationKey: saved.conversationKey },
      fromCanonicalUrl: from,
      toCanonicalUrl: to,
    });
    await autoSyncEntered;

    gate.closeAdmissions();
    let drained = false;
    const drain = gate.waitForDrained().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();

    releaseAutoSync();
    const response = await responsePromise;
    await drain;

    expect(response).toMatchObject({ ok: true, data: { conversationId: saved.id, merged: false } });
    expect(drained).toBe(true);
    expect(onConversationChanged).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('rejects a compound URL operation before any facts write when admissions are already closed', async () => {
    const from = 'https://example.com/closed-from';
    const to = 'https://example.com/closed-to';
    const saved = await conversations.upsertConversation(article(from, 'Closed'));
    const gate = new FactsOperationGate({
      readJournal: async () => ({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null }),
    });
    await gate.initializeFromJournal();
    gate.closeAdmissions();
    const onConversationChanged = vi.fn();
    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    registerConversationHandlers(router as any, {
      conversationReadRunner: createRunner(gate),
      onConversationChanged,
      streamRouter: { register: () => {} },
    });
    const broadcast = vi.fn();
    router.eventsHub.broadcast = broadcast;

    const response = await router.__handleMessageForTests({
      type: CORE_MESSAGE_TYPES.UPDATE_ARTICLE_URL,
      factsEpoch: 'idb-v1',
      conversation: { source: saved.source, conversationKey: saved.conversationKey },
      fromCanonicalUrl: from,
      toCanonicalUrl: to,
    });

    expect(response).toMatchObject({ ok: false, error: { extra: { code: 'MIGRATION_IN_PROGRESS' } } });
    expect(onConversationChanged).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    expect(await conversations.findConversationBySourceAndKey(saved.source, saved.conversationKey)).toMatchObject({
      id: saved.id,
      url: from,
    });
    expect(await conversations.findConversationBySourceAndKey(saved.source, `article:${to}`)).toBeNull();
  });

  it('rejects browser numeric handles before opening the compound operation', async () => {
    const from = 'https://example.com/numeric-from';
    const to = 'https://example.com/numeric-to';
    const saved = await conversations.upsertConversation(article(from, 'Numeric'));
    const gate = new FactsOperationGate({
      readJournal: async () => ({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null }),
    });
    await gate.initializeFromJournal();
    const runner = createRunner(gate);
    const run = vi.spyOn(runner, 'run');
    const router = createBackgroundRouter({ fallback: () => ({ ok: false, data: null, error: null }) });
    registerConversationHandlers(router as any, {
      conversationReadRunner: runner,
      onConversationChanged: vi.fn(),
      streamRouter: { register: () => {} },
    });

    const response = await router.__handleMessageForTests({
      type: CORE_MESSAGE_TYPES.UPDATE_ARTICLE_URL,
      factsEpoch: 'idb-v1',
      conversation: { source: saved.source, conversationKey: saved.conversationKey, conversationId: saved.id },
      fromCanonicalUrl: from,
      toCanonicalUrl: to,
    });

    expect(response).toMatchObject({ ok: false });
    expect(run).not.toHaveBeenCalled();
    expect(await conversations.getConversationById(saved.id)).toMatchObject({
      url: from,
      conversationKey: `article:${from}`,
    });
  });
});

describe('Native article URL compound routing', () => {
  it('sends one Host command with resolved backend handles for both confirmed identities', async () => {
    nativeConnect.mockResolvedValue({
      commentsUpdated: 2,
      conversationId: 22,
      conversationKey: 'article:https://example.com/to',
      conversationSource: 'web',
      merged: true,
      removedConversationId: 11,
      toCanonicalUrl: 'https://example.com/to',
      fromCanonicalUrl: 'https://example.com/from',
    });

    const result = await runIdbOperation(
      async (lease) =>
        await createArticleUrlOperation({ lease, mode: 'native' }).update({
          conversation: { source: 'web', conversationKey: 'article:https://example.com/from', conversationId: 11 },
          confirmedConflict: { source: 'web', conversationKey: 'article:https://example.com/to', conversationId: 22 },
          fromCanonicalUrl: 'https://example.com/from',
          toCanonicalUrl: 'https://example.com/to',
        }),
    );

    expect(nativeConnect).toHaveBeenCalledTimes(1);
    expect(nativeConnect).toHaveBeenCalledWith({
      command: 'UPDATE_ARTICLE_URL',
      payload: {
        conversation: {
          source: 'web',
          conversationKey: 'article:https://example.com/from',
          backendConversationId: 11,
        },
        confirmedConflict: {
          source: 'web',
          conversationKey: 'article:https://example.com/to',
          backendConversationId: 22,
        },
        fromCanonicalUrl: 'https://example.com/from',
        toCanonicalUrl: 'https://example.com/to',
      },
    });
    expect(result).toEqual({
      commentsUpdated: 2,
      conversation: { source: 'web', conversationKey: 'article:https://example.com/to', conversationId: 22 },
      merged: true,
      removedConversationId: 11,
    });
  });
});

describe('IDB article URL compound operation', () => {
  it('updates the article identity, mapping, and attached/orphan comments in one operation', async () => {
    const from = 'https://example.com/from';
    const to = 'https://example.com/to';
    const saved = await conversations.upsertConversation(article(from, 'Source'));
    await conversations.syncConversationMessages(saved.id, [
      { messageKey: 'm-1', role: 'assistant', contentText: 'body', sequence: 1 },
    ]);
    await conversations.setSyncCursor(saved.id, { lastSyncedMessageKey: 'm-1', lastSyncedSequence: 1 });
    const attached = await comments.addArticleComment({
      canonicalUrl: from,
      conversationId: saved.id,
      commentText: 'attached',
    });
    const orphan = await comments.addArticleComment({ canonicalUrl: from, commentText: 'orphan' });

    const result = await runIdbOperation(
      async (lease) =>
        await createArticleUrlOperation({ lease, mode: 'idb' }).update({
          conversation: { source: saved.source, conversationKey: saved.conversationKey, conversationId: saved.id },
          fromCanonicalUrl: from,
          toCanonicalUrl: `${to}#fragment`,
        }),
    );

    expect(result).toMatchObject({
      commentsUpdated: 2,
      conversation: { source: 'web', conversationKey: `article:${to}`, conversationId: saved.id },
      merged: false,
    });
    expect(await conversations.findConversationBySourceAndKey('web', `article:${from}`)).toBeNull();
    expect(await conversations.getConversationById(saved.id)).toMatchObject({
      url: to,
      conversationKey: `article:${to}`,
    });
    expect((await conversations.getMessagesByConversationId(saved.id)).map((row) => row.messageKey)).toEqual(['m-1']);
    expect((await conversations.getSyncMappingByConversation(saved.id))?.mapping).toMatchObject({
      source: 'web',
      conversationKey: `article:${to}`,
    });
    expect((await comments.listArticleCommentsByCanonicalUrl(to)).map((row) => row.id)).toEqual([
      attached.id,
      orphan.id,
    ]);
    expect((await comments.listArticleCommentsByConversationId(saved.id)).map((row) => row.id)).toEqual([attached.id]);
    expect(await comments.listArticleCommentsByCanonicalUrl(from)).toEqual([]);
  });

  it('merges only the confirmed conflict and keeps target message/image duplicates while moving source-only facts and comments', async () => {
    const from = 'https://example.com/source';
    const to = 'https://example.com/target';
    const source = await conversations.upsertConversation(article(from, 'Source'));
    const target = await conversations.upsertConversation(article(to, 'Target'));
    await conversations.syncConversationMessages(source.id, [
      { messageKey: 'shared', role: 'assistant', contentText: 'source shared', sequence: 1 },
      { messageKey: 'source-only', role: 'assistant', contentText: 'source only', sequence: 2 },
    ]);
    await conversations.syncConversationMessages(target.id, [
      { messageKey: 'shared', role: 'assistant', contentText: 'target shared', sequence: 1 },
      { messageKey: 'target-only', role: 'assistant', contentText: 'target only', sequence: 2 },
    ]);
    await conversations.setSyncCursor(source.id, { lastSyncedMessageKey: 'source-only', lastSyncedSequence: 2 });
    await conversations.setSyncCursor(target.id, { lastSyncedMessageKey: 'target-only', lastSyncedSequence: 2 });
    const sourceRoot = await comments.addArticleComment({
      canonicalUrl: from,
      conversationId: source.id,
      commentText: 'source',
    });
    const sourceOrphan = await comments.addArticleComment({ canonicalUrl: from, commentText: 'orphan' });
    const targetRoot = await comments.addArticleComment({
      canonicalUrl: to,
      conversationId: target.id,
      commentText: 'target',
    });

    const imageIds = await runIdbOperation(async (lease) => {
      const images = createImageStorage({ lease, mode: 'idb' });
      const sourceOwner = { source: source.source, conversationKey: source.conversationKey, conversationId: source.id };
      const targetOwner = { source: target.source, conversationKey: target.conversationKey, conversationId: target.id };
      const sourceShared = await images.putAsset({
        owner: sourceOwner,
        url: 'https://example.com/shared.png',
        blob: new Blob([Uint8Array.from([1])], { type: 'image/png' }),
        byteSize: 1,
        contentType: 'image/png',
      });
      const sourceOnly = await images.putAsset({
        owner: sourceOwner,
        url: 'https://example.com/source.png',
        blob: new Blob([Uint8Array.from([2])], { type: 'image/png' }),
        byteSize: 1,
        contentType: 'image/png',
      });
      const targetShared = await images.putAsset({
        owner: targetOwner,
        url: 'https://example.com/shared.png',
        blob: new Blob([Uint8Array.from([3])], { type: 'image/png' }),
        byteSize: 1,
        contentType: 'image/png',
      });
      return { sourceShared, sourceOnly, targetShared };
    });

    const result = await runIdbOperation(
      async (lease) =>
        await createArticleUrlOperation({ lease, mode: 'idb' }).update({
          conversation: { source: source.source, conversationKey: source.conversationKey, conversationId: source.id },
          confirmedConflict: {
            source: target.source,
            conversationKey: target.conversationKey,
            conversationId: target.id,
          },
          fromCanonicalUrl: from,
          toCanonicalUrl: to,
        }),
    );

    expect(result).toMatchObject({
      commentsUpdated: 2,
      conversation: { conversationId: target.id, source: 'web', conversationKey: `article:${to}` },
      merged: true,
      removedConversationId: source.id,
    });
    expect(await conversations.getConversationById(source.id)).toBeNull();
    expect((await conversations.getMessagesByConversationId(target.id)).map((row) => row.messageKey).sort()).toEqual([
      'shared',
      'source-only',
      'target-only',
    ]);
    expect(
      (await conversations.getMessagesByConversationId(target.id)).find((row) => row.messageKey === 'shared')
        ?.contentText,
    ).toBe('target shared');
    expect((await conversations.getSyncMappingByConversation(target.id))?.mapping).toMatchObject({
      lastSyncedMessageKey: 'target-only',
      conversationKey: `article:${to}`,
    });
    expect((await comments.listArticleCommentsByCanonicalUrl(to)).map((row) => row.id)).toEqual([
      sourceRoot.id,
      sourceOrphan.id,
      targetRoot.id,
    ]);
    expect((await comments.listArticleCommentsByConversationId(target.id)).map((row) => row.id)).toEqual([
      sourceRoot.id,
      targetRoot.id,
    ]);

    await runIdbOperation(async (lease) => {
      const images = createImageStorage({ lease, mode: 'idb' });
      const targetOwner = { source: target.source, conversationKey: target.conversationKey, conversationId: target.id };
      expect(await images.getAsset(targetOwner, imageIds.sourceShared.id)).toBeNull();
      expect((await images.getAsset(targetOwner, imageIds.targetShared.id))?.blob.size).toBe(1);
      expect((await images.getAsset(targetOwner, imageIds.sourceOnly.id))?.id).toBe(imageIds.sourceOnly.id);
    });
  });

  it('keeps the target row when both sides have the same exact whitespace message key', async () => {
    const from = 'https://example.com/exact-duplicate-source';
    const to = 'https://example.com/exact-duplicate-target';
    const source = await conversations.upsertConversation(article(from, 'Source'));
    const target = await conversations.upsertConversation(article(to, 'Target'));
    await conversations.syncConversationMessages(source.id, [
      { messageKey: ' shared ', role: 'assistant', contentText: 'source', sequence: 1 },
    ]);
    await conversations.syncConversationMessages(target.id, [
      { messageKey: ' shared ', role: 'assistant', contentText: 'target', sequence: 1 },
    ]);

    await runIdbOperation(
      async (lease) =>
        await createArticleUrlOperation({ lease, mode: 'idb' }).update({
          conversation: { source: source.source, conversationKey: source.conversationKey, conversationId: source.id },
          confirmedConflict: {
            source: target.source,
            conversationKey: target.conversationKey,
            conversationId: target.id,
          },
          fromCanonicalUrl: from,
          toCanonicalUrl: to,
        }),
    );

    expect(await conversations.getMessagesByConversationId(target.id)).toMatchObject([
      { messageKey: ' shared ', contentText: 'target' },
    ]);
  });

  it('preserves message keys that differ only by surrounding whitespace during conflict merge', async () => {
    const from = 'https://example.com/exact-distinct-source';
    const to = 'https://example.com/exact-distinct-target';
    const source = await conversations.upsertConversation(article(from, 'Source'));
    const target = await conversations.upsertConversation(article(to, 'Target'));
    await conversations.syncConversationMessages(source.id, [
      { messageKey: ' shared ', role: 'assistant', contentText: 'source', sequence: 1 },
    ]);
    await conversations.syncConversationMessages(target.id, [
      { messageKey: 'shared', role: 'assistant', contentText: 'target', sequence: 1 },
    ]);

    await runIdbOperation(
      async (lease) =>
        await createArticleUrlOperation({ lease, mode: 'idb' }).update({
          conversation: { source: source.source, conversationKey: source.conversationKey, conversationId: source.id },
          confirmedConflict: {
            source: target.source,
            conversationKey: target.conversationKey,
            conversationId: target.id,
          },
          fromCanonicalUrl: from,
          toCanonicalUrl: to,
        }),
    );

    expect((await conversations.getMessagesByConversationId(target.id)).map((row) => row.messageKey).sort()).toEqual([
      ' shared ',
      'shared',
    ]);
  });

  it('rejects an unconfirmed or stale conflict without changing either article or its comments', async () => {
    const from = 'https://example.com/race-source';
    const to = 'https://example.com/race-target';
    const source = await conversations.upsertConversation(article(from, 'Source'));
    const target = await conversations.upsertConversation(article(to, 'Target'));
    const comment = await comments.addArticleComment({
      canonicalUrl: from,
      conversationId: source.id,
      commentText: 'source',
    });

    await expect(
      runIdbOperation(
        async (lease) =>
          await createArticleUrlOperation({ lease, mode: 'idb' }).update({
            conversation: { source: source.source, conversationKey: source.conversationKey, conversationId: source.id },
            fromCanonicalUrl: from,
            toCanonicalUrl: to,
          }),
      ),
    ).rejects.toMatchObject({ code: 'STALE_REFERENCE' });

    await expect(
      runIdbOperation(
        async (lease) =>
          await createArticleUrlOperation({ lease, mode: 'idb' }).update({
            conversation: { source: source.source, conversationKey: source.conversationKey, conversationId: source.id },
            confirmedConflict: {
              source: target.source,
              conversationKey: target.conversationKey,
              conversationId: target.id + 100,
            },
            fromCanonicalUrl: from,
            toCanonicalUrl: to,
          }),
      ),
    ).rejects.toMatchObject({ code: 'STALE_REFERENCE' });

    expect(await conversations.getConversationById(source.id)).toMatchObject({
      url: from,
      conversationKey: `article:${from}`,
    });
    expect(await conversations.getConversationById(target.id)).toMatchObject({
      url: to,
      conversationKey: `article:${to}`,
    });
    expect((await comments.listArticleCommentsByCanonicalUrl(from)).map((row) => row.id)).toEqual([comment.id]);
    expect(await comments.listArticleCommentsByCanonicalUrl(to)).toEqual([]);
  });
});
