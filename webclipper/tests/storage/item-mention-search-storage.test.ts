import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import {
  __closeDbForTests,
  searchConversationMentionCandidates,
  upsertConversation,
} from '@services/conversations/data/storage-idb';

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

async function deleteDb(name: string) {
  const req = indexedDB.deleteDatabase(name);
  await reqToPromise(req as unknown as IDBRequest<unknown>);
}

beforeEach(async () => {
  await __closeDbForTests();
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(async () => {
  await __closeDbForTests();
});

describe('item mention storage search', () => {
  it('returns recent candidates in desc order', async () => {
    const ts = Date.now();
    const a = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'm-a',
      title: 'A',
      url: 'https://chatgpt.com/c/a',
      lastCapturedAt: ts,
    });
    const b = await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'm-b',
      title: 'B',
      url: 'https://chatgpt.com/c/b',
      lastCapturedAt: ts,
    });
    const c = await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'm-c',
      title: 'C',
      url: 'https://example.com/c',
      lastCapturedAt: ts - 1,
    });

    const res = await searchConversationMentionCandidates({
      query: '',
      limit: 10,
      maxScan: 1000,
      maxDurationMs: 10_000,
    });
    expect(res.candidates.map((x) => x.conversationId)).toEqual([Number(b.id), Number(a.id), Number(c.id)]);
    expect(res.candidates[0]?.title).toBe('B');
  });

  it('filters by title/source/domain', async () => {
    const now = Date.now();
    await upsertConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'openai-domain',
      title: 'Something',
      url: 'https://openai.com/blog',
      lastCapturedAt: now,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'openai',
      conversationKey: 'openai-source',
      title: 'Other',
      url: 'https://example.com',
      lastCapturedAt: now - 1,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'openai-title',
      title: 'OpenAI report',
      url: 'https://x.com',
      lastCapturedAt: now - 2,
    });
    await upsertConversation({
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'no-match',
      title: 'Nothing',
      url: 'https://y.com',
      lastCapturedAt: now - 3,
    });

    const res = await searchConversationMentionCandidates({
      query: 'openai',
      limit: 20,
      maxScan: 2000,
      maxDurationMs: 10_000,
    });
    expect(res.candidates.length).toBe(3);
    expect(
      res.candidates.every((c) =>
        String(c.title + c.source + c.domain)
          .toLowerCase()
          .includes('openai'),
      ),
    ).toBe(true);
  });

  it('respects scan limit and exposes truncation flag', async () => {
    const now = Date.now();
    for (let i = 0; i < 20; i += 1) {
      await upsertConversation({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: `scan-${i + 1}`,
        title: `Row ${i + 1}`,
        url: 'https://example.com',
        lastCapturedAt: now - i,
      });
    }

    const res = await searchConversationMentionCandidates({
      query: 'never-matches',
      limit: 20,
      maxScan: 1,
      maxDurationMs: 10_000,
    });
    expect(res.scannedCount).toBe(1);
    expect(res.truncatedByScanLimit).toBe(true);
  });
});
