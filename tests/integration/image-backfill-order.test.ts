import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

const image = vi.hoisted(() => ({ inline: vi.fn() }));
vi.mock('@services/conversations/data/image-inline', () => ({
  inlineChatImagesInMessages: (...args: unknown[]) => image.inline(...args),
}));
vi.mock('@services/shared/storage', () => ({
  storageGet: async () => ({ web_article_cache_images_enabled: true }),
}));

import { openDb, closeDbForTests } from '@platform/idb/schema';
import { getMessagesByConversationId } from '@services/conversations/data/storage-idb';
import { backfillConversationImages } from '@services/conversations/background/image-backfill-job';

function request<T>(input: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    input.onsuccess = () => resolve(input.result);
    input.onerror = () => reject(input.error ?? new Error('IDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IDB write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IDB write aborted'));
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const original = 'Text first. ![photo](https://example.com/p.png)';
const filled = 'Text first. ![photo](syncnos-asset://25)';

async function createArticle(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(['conversations', 'messages'], 'readwrite');
  const done = transactionDone(tx);
  const conversationId = Number(
    await request(
      tx.objectStore('conversations').add({
        source: 'web',
        sourceType: 'article',
        conversationKey: 'article:https://example.com/p',
        title: 'Article',
        lastActivityAt: 123,
      }),
    ),
  );
  await request(
    tx.objectStore('messages').add({
      conversationId,
      messageKey: 'article_body',
      role: 'article',
      sequence: 1,
      contentMarkdown: original,
      updatedAt: 123,
    }),
  );
  await done;
  return conversationId;
}

async function currentMarkdown(conversationId: number): Promise<string> {
  const messages = await getMessagesByConversationId(conversationId);
  return String(messages[0]?.contentMarkdown ?? '');
}

beforeEach(async () => {
  closeDbForTests();
  vi.stubGlobal('indexedDB', indexedDB);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  await request(indexedDB.deleteDatabase('webclipper'));
  image.inline.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  closeDbForTests();
});

describe('durable article body and deferred image CAS', () => {
  it('keeps the original article readable while its image request is pending, then patches only Markdown', async () => {
    const conversationId = await createArticle();
    const started = deferred();
    const release = deferred();
    image.inline.mockImplementation(async ({ messages }: any) => {
      started.resolve();
      await release.promise;
      return {
        messages: messages.map((message: any) => ({ ...message, contentMarkdown: filled })),
        inlinedCount: 1,
        fromCacheCount: 0,
        downloadedCount: 1,
        inlinedBytes: 20,
        warningFlags: [],
      };
    });
    const pending = backfillConversationImages({ conversationId });
    await started.promise;
    expect(await currentMarkdown(conversationId)).toBe(original);

    release.resolve();
    const result = await pending;
    expect(result).toMatchObject({ updatedMessages: 1, conflicts: 0 });
    expect(await currentMarkdown(conversationId)).toBe(filled);
    const db = await openDb();
    expect(
      ((await request(db.transaction('conversations').objectStore('conversations').get(conversationId))) as any)
        .lastActivityAt,
    ).toBe(123);
  });

  it('does not overwrite user edits that commit while an image request is pending', async () => {
    const conversationId = await createArticle();
    const started = deferred();
    const release = deferred();
    image.inline.mockImplementation(async ({ messages }: any) => {
      started.resolve();
      await release.promise;
      return {
        messages: messages.map((message: any) => ({ ...message, contentMarkdown: filled })),
        inlinedCount: 1,
        fromCacheCount: 0,
        downloadedCount: 1,
        inlinedBytes: 20,
        warningFlags: [],
      };
    });
    const pending = backfillConversationImages({ conversationId });
    await started.promise;
    const db = await openDb();
    const tx = db.transaction('messages', 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore('messages');
    const items = await request(store.getAll());
    await request(store.put({ ...(items[0] as any), contentMarkdown: 'User edit' }));
    await done;
    release.resolve();

    expect(await pending).toMatchObject({ updatedMessages: 0, conflicts: 1 });
    expect(await currentMarkdown(conversationId)).toBe('User edit');
  });

  it('keeps stored Markdown unchanged when the later image task fails', async () => {
    const conversationId = await createArticle();
    image.inline.mockRejectedValueOnce(new Error('download failed'));
    await expect(backfillConversationImages({ conversationId })).rejects.toThrow('download failed');
    expect(await currentMarkdown(conversationId)).toBe(original);
  });
});
