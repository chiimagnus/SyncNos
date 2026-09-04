import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDBDatabase, IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { DATA_REVISION_STORE_BY_SCOPE } from '@platform/idb/data-revision-record';
import { closeDbForTests, openDb } from '@platform/idb/schema';
import {
  __resetConversationStorageStateForTests,
  readConversationMentionCandidatePool,
  upsertConversation,
} from '@services/conversations/data/storage-idb';

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('indexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('indexedDB transaction aborted'));
  });
}

async function deleteDb(name: string) {
  const req = indexedDB.deleteDatabase(name);
  await reqToPromise(req as unknown as IDBRequest<unknown>);
}

beforeEach(async () => {
  __resetConversationStorageStateForTests();
  closeDbForTests();
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(async () => {
  vi.restoreAllMocks();
  __resetConversationStorageStateForTests();
  closeDbForTests();
});

describe('item mention candidate pool storage', () => {
  it('returns a query-independent recent pool and projects persisted list-site keys', async () => {
    const ts = Date.now();
    const a = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'm-a',
      title: 'No keyword here',
      url: 'https://chatgpt.com/c/a',
      lastCapturedAt: ts,
    });
    const b = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'm-b',
      title: 'OpenAI article',
      url: 'https://openai.com/blog',
      lastCapturedAt: ts - 1,
    });

    const res = await readConversationMentionCandidatePool({ maxScan: 1000, maxDurationMs: 10_000 });

    expect(res.candidates.map((candidate) => candidate.conversationId)).toEqual([Number(a.id), Number(b.id)]);
    expect(res.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conversationId: Number(a.id), domain: 'chatgpt.com' }),
        expect.objectContaining({ conversationId: Number(b.id), domain: 'openai.com' }),
      ]),
    );
    expect(res.revision).toBe(2);
  });

  it('projects domain from the raw persisted listSiteKey instead of reparsing the row URL', async () => {
    const db = await openDb();
    const writeTx = db.transaction(['conversations'], 'readwrite');
    const store = writeTx.objectStore('conversations');
    // Test-only sentinel: the mismatch distinguishes raw-key projection from read-time URL normalization;
    // malformed rows still are not a runtime compatibility contract.
    const conversationId = Number(
      await reqToPromise(
        store.add({
          sourceType: 'chat',
          source: 'chatgpt',
          conversationKey: 'raw-persisted-site-key',
          title: 'Persisted site key sentinel',
          url: 'https://url-derived.example/path',
          listSourceKey: 'chatgpt',
          listSiteKey: 'domain:persisted-contract.example',
          lastCapturedAt: 1,
        }),
      ),
    );
    await txDone(writeTx);

    const res = await readConversationMentionCandidatePool({ maxScan: 10, maxDurationMs: 10_000 });

    expect(res.candidates).toEqual([
      expect.objectContaining({
        conversationId,
        domain: 'persisted-contract.example',
      }),
    ]);
    expect(res.revision).toBe(0);
  });

  it('does not stop after the first 50 rows and leaves matching entirely to the scorer', async () => {
    const now = Date.now();
    await Promise.all(
      Array.from({ length: 51 }, (_, index) =>
        upsertConversation({
          sourceType: 'chat',
          source: index < 50 ? 'openai-weak' : 'chatgpt',
          conversationKey: `pool-${index}`,
          title: index === 50 ? 'OpenAI' : `Row ${index}`,
          url: `https://example.com/${index}`,
          lastCapturedAt: now - index,
        }),
      ),
    );

    const res = await readConversationMentionCandidatePool({ maxScan: 51, maxDurationMs: 10_000 });

    expect(res.candidates).toHaveLength(51);
    expect(res.candidates[50]).toMatchObject({ title: 'OpenAI', source: 'chatgpt' });
  });

  it('reads conversation rows and their revision in one readonly transaction', async () => {
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'snapshot-one',
      title: 'One',
      url: 'https://chatgpt.com/c/one',
      lastCapturedAt: 1,
    });

    const transactionSpy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const res = await readConversationMentionCandidatePool({ maxScan: 20, maxDurationMs: 10_000 });

    expect(res.revision).toBe(1);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    const [storeNames, mode] = transactionSpy.mock.calls[0] || [];
    expect(storeNames).toEqual(['conversations', DATA_REVISION_STORE_BY_SCOPE.conversations]);
    expect(mode).toBe('readonly');
  });

  it('keeps maxScan and maxDuration as bounded recent-search guards', async () => {
    const now = Date.now();
    for (let index = 0; index < 3; index += 1) {
      await upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: `guard-${index}`,
        title: `Guard ${index}`,
        url: `https://example.com/${index}`,
        lastCapturedAt: now - index,
      });
    }

    const scanLimited = await readConversationMentionCandidatePool({ maxScan: 1, maxDurationMs: 10_000 });
    expect(scanLimited.candidates).toHaveLength(1);

    let nowCalls = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (nowCalls++ === 0 ? 0 : 1_000));
    const durationLimited = await readConversationMentionCandidatePool({ maxScan: 100, maxDurationMs: 10 });
    expect(durationLimited.candidates).toHaveLength(1);
  });
});
