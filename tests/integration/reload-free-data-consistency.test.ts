import { readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { closeDbForTests } from '@platform/idb/schema';
import { listArticleCommentsByConversationId, deleteArticleCommentById } from '@services/comments/data/storage';
import { backgroundStorage } from '@services/conversations/background/storage';
import { getImageCacheAssetById } from '@services/conversations/data/image-cache-read';
import { __resetConversationStorageStateForTests } from '@services/conversations/data/storage-idb';
import {
  getConversationBySourceConversationKey,
  getConversationDetail,
  getConversationListBootstrap,
} from '@services/conversations/data/storage';
import { createDataRevisionObserver } from '@services/data-revisions/observer';
import { readDataRevisionSnapshot } from '@services/data-revisions/storage-idb';
import { subscribeDataRevisionWake } from '@services/data-revisions/wake';
import { importBackupZipV2Merge } from '@services/sync/backup/import';
import { extractZipEntries } from '@services/sync/backup/zip-utils';

import {
  BACKUP_V2_FIXTURE_CAPTURED_AT,
  buildBackupV2FixtureEntries,
  createBackupV2FixtureZip,
  writeBackupV2FixtureZip,
} from '../helpers/backup-v2-fixture';

function mockChromeStorage() {
  const store: Record<string, unknown> = {};
  return {
    runtime: { lastError: null as any },
    storage: {
      local: {
        get(keys: string[] | string | null, callback: (result: Record<string, unknown>) => void) {
          if (keys == null) {
            callback({ ...store });
            return;
          }
          const list = Array.isArray(keys) ? keys : [keys];
          callback(Object.fromEntries(list.map((key) => [key, store[key] ?? null])));
        },
        set(payload: Record<string, unknown>, callback?: () => void) {
          Object.assign(store, payload || {});
          callback?.();
        },
        remove(keys: string[] | string, callback?: () => void) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
          callback?.();
        },
      },
    },
  };
}

function createRealRevisionObserver() {
  return createDataRevisionObserver({
    readSnapshot: readDataRevisionSnapshot,
    subscribeWake: subscribeDataRevisionWake,
    subscribeStorage: () => () => {},
    getDocument: () => null,
    getWindow: () => null,
    readinessTimeoutMs: 100,
    retryReconcileMs: 5,
    safetyReconcileMs: 60_000,
  });
}

function relevantScopes(scopes: readonly string[], allowed: readonly string[]): string[] {
  const wanted = new Set(allowed);
  return scopes.filter((scope) => wanted.has(scope));
}

async function mountListConsumerHarness(observer: ReturnType<typeof createRealRevisionObserver>) {
  let bundle: Awaited<ReturnType<typeof getConversationListBootstrap>> | null = null;
  let reads = 0;
  let failures = 0;
  let failNextRead = false;
  let disposed = false;
  let draining = false;
  const pendingScopes = new Set<string>();

  const readCanonical = async () => {
    reads += 1;
    if (failNextRead) {
      failNextRead = false;
      throw new Error('forced list apply read failure');
    }
    return await getConversationListBootstrap({}, 20);
  };

  const drain = async () => {
    if (disposed || draining || !pendingScopes.size) return;
    draining = true;
    try {
      while (!disposed && pendingScopes.size) {
        const batch = relevantScopes([...pendingScopes], ['conversations', 'article_comments']);
        pendingScopes.clear();
        if (!batch.length) continue;
        try {
          const next = await readCanonical();
          if (!disposed) bundle = next;
        } catch (_error) {
          failures += 1;
          observer.requestRetry(batch as any);
        }
      }
    } finally {
      draining = false;
      if (!disposed && pendingScopes.size) void drain();
    }
  };

  const unsubscribe = observer.subscribe((scopes) => {
    for (const scope of relevantScopes(scopes, ['conversations', 'article_comments'])) pendingScopes.add(scope);
    void drain();
  });
  await observer.whenReady();
  bundle = await readCanonical();

  return {
    get bundle() {
      return bundle;
    },
    get reads() {
      return reads;
    },
    get failures() {
      return failures;
    },
    failNext() {
      failNextRead = true;
    },
    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}

async function mountCommentsConsumerHarness(
  observer: ReturnType<typeof createRealRevisionObserver>,
  conversationId: number,
) {
  let comments = await listArticleCommentsByConversationId(conversationId);
  let reads = 1;
  let failures = 0;
  let failNextRead = false;
  let disposed = false;
  let draining = false;
  let pending = false;

  const drain = async () => {
    if (disposed || draining || !pending) return;
    draining = true;
    try {
      while (!disposed && pending) {
        pending = false;
        reads += 1;
        try {
          if (failNextRead) {
            failNextRead = false;
            throw new Error('forced comments apply read failure');
          }
          const next = await listArticleCommentsByConversationId(conversationId);
          if (!disposed) comments = next;
        } catch (_error) {
          failures += 1;
          observer.requestRetry(['article_comments']);
        }
      }
    } finally {
      draining = false;
      if (!disposed && pending) void drain();
    }
  };

  const unsubscribe = observer.subscribe((scopes) => {
    if (!scopes.includes('article_comments')) return;
    pending = true;
    void drain();
  });
  await observer.whenReady();

  return {
    get comments() {
      return comments;
    },
    get reads() {
      return reads;
    },
    get failures() {
      return failures;
    },
    failNext() {
      failNextRead = true;
    },
    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}

beforeEach(() => {
  __resetConversationStorageStateForTests();
  closeDbForTests();
  // @ts-expect-error fake IndexedDB test global
  globalThis.indexedDB = new IDBFactory();
  // @ts-expect-error fake IndexedDB test global
  globalThis.IDBKeyRange = IDBKeyRange;
  // @ts-expect-error test global
  globalThis.chrome = mockChromeStorage();
  // @ts-expect-error test global
  globalThis.browser = undefined;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BACKUP_V2_FIXTURE_CAPTURED_AT + 60_000);
});

afterEach(() => {
  vi.useRealTimers();
  __resetConversationStorageStateForTests();
  closeDbForTests();
  delete (globalThis as any).chrome;
  delete (globalThis as any).browser;
});

describe('reload-free data consistency production chain', () => {
  it('builds a deterministic full-scope ZIP and imports canonical List/Detail/Header-input/Comments/Asset data once', async () => {
    const zipA = new Uint8Array(await (await createBackupV2FixtureZip()).arrayBuffer());
    const zipB = new Uint8Array(await (await createBackupV2FixtureZip()).arrayBuffer());
    expect(zipB).toEqual(zipA);

    const written = await writeBackupV2FixtureZip();
    try {
      const diskBytes = new Uint8Array(await readFile(written.path));
      const diskEntries = await extractZipEntries(new Blob([diskBytes], { type: 'application/zip' }));
      expect([...diskEntries.keys()].sort()).toEqual([...buildBackupV2FixtureEntries().entries.keys()].sort());
    } finally {
      await rm(dirname(written.path), { recursive: true, force: true });
    }

    const fixture = buildBackupV2FixtureEntries();
    const first = await importBackupZipV2Merge(fixture.entries);
    expect(first).toMatchObject({
      conversationsAdded: 3,
      messagesAdded: 4,
      mappingsAdded: 1,
      commentsAdded: 2,
    });

    const firstVector = await readDataRevisionSnapshot();
    for (const revision of Object.values(firstVector)) expect(revision).toBeGreaterThan(0);

    const list = await getConversationListBootstrap({}, 20);
    expect(list.summary).toEqual({ totalCount: 3, todayCount: 3 });
    expect(list.items).toHaveLength(3);
    expect(list.facets.sources.map((facet) => facet.key)).toEqual(expect.arrayContaining(['chatgpt', 'web', 'youtube']));

    const chat = await getConversationBySourceConversationKey(
      fixture.expected.chat.source,
      fixture.expected.chat.conversationKey,
    );
    expect(chat).toMatchObject({
      title: fixture.expected.chat.title,
      author: 'Fixture Author',
      warningFlags: fixture.expected.chat.warningFlags,
      notionPageId: 'fixture-notion-page',
      feishuDocId: 'fixture-feishu-doc',
    });
    const chatId = Number(chat?.id);
    const detail = await getConversationDetail(chatId);
    expect(detail.messages).toHaveLength(2);
    const assetRef = /syncnos-asset:\/\/(\d+)/.exec(String(detail.messages[1]?.contentMarkdown || ''));
    expect(assetRef).not.toBeNull();
    const restoredAssetId = Number(assetRef?.[1]);
    expect(restoredAssetId).toBeGreaterThan(0);
    await expect(getImageCacheAssetById({ id: restoredAssetId, conversationId: chatId })).resolves.toMatchObject({
      url: 'https://images.example.test/reload-free-fixture.png',
      contentType: 'image/png',
      byteSize: 4,
    });
    const mapping = await backgroundStorage.getSyncMappingByConversation(chatId);
    expect(mapping?.mapping).toMatchObject({
      notionPageId: 'fixture-notion-page',
      notionPageUrl: 'https://www.notion.so/fixture-workspace/fixture-notion-page',
      notionWorkspaceSlug: 'fixture-workspace',
      feishuDocId: 'fixture-feishu-doc',
      githubRemoteKey: 'github.com/fixture/repo@main',
    });

    const article = await getConversationBySourceConversationKey(
      fixture.expected.article.source,
      fixture.expected.article.conversationKey,
    );
    const comments = await listArticleCommentsByConversationId(Number(article?.id));
    expect(comments).toHaveLength(2);
    expect(comments.filter((comment) => comment.parentId == null)).toHaveLength(1);

    const observer = createRealRevisionObserver();
    const listConsumer = await mountListConsumerHarness(observer);
    const readsBeforeIdenticalImport = listConsumer.reads;
    const repeated = await importBackupZipV2Merge(fixture.entries);
    expect(repeated).toMatchObject({
      conversationsAdded: 0,
      conversationsUpdated: 0,
      messagesAdded: 0,
      messagesUpdated: 0,
      mappingsAdded: 0,
      mappingsUpdated: 0,
      commentsAdded: 0,
      commentsUpdated: 0,
    });
    expect(await readDataRevisionSnapshot()).toEqual(firstVector);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(listConsumer.reads).toBe(readsBeforeIdenticalImport);
    listConsumer.dispose();
  });

  it('replays a failed mounted List canonical read against an unchanged revision vector and preserves the last-good bundle', async () => {
    const base = buildBackupV2FixtureEntries();
    await importBackupZipV2Merge(base.entries);

    const observer = createRealRevisionObserver();
    const listConsumer = await mountListConsumerHarness(observer);
    expect(listConsumer.bundle?.items.find((item) => item.source === 'chatgpt')?.warningFlags).toEqual(
      base.expected.chat.warningFlags,
    );
    const readsBeforeMutation = listConsumer.reads;
    const vectorBeforeMutation = await readDataRevisionSnapshot();

    listConsumer.failNext();
    const changed = buildBackupV2FixtureEntries({ extraChatWarning: 'fixture-warning-updated' });
    const stats = await importBackupZipV2Merge(changed.entries);
    expect(stats).toMatchObject({
      conversationsAdded: 0,
      conversationsUpdated: 1,
      messagesAdded: 0,
      messagesUpdated: 0,
      mappingsAdded: 0,
      mappingsUpdated: 0,
      commentsAdded: 0,
      commentsUpdated: 0,
    });
    const vectorAfterMutation = await readDataRevisionSnapshot();
    expect(vectorAfterMutation.conversations).toBe(vectorBeforeMutation.conversations + 1);
    expect({ ...vectorAfterMutation, conversations: 0 }).toEqual({ ...vectorBeforeMutation, conversations: 0 });

    await vi.waitFor(() => expect(listConsumer.failures).toBe(1));
    expect(listConsumer.bundle?.items.find((item) => item.source === 'chatgpt')?.warningFlags).toEqual(
      base.expected.chat.warningFlags,
    );
    const bundleAfterFailure = listConsumer.bundle;
    expect(bundleAfterFailure?.summary).toEqual({ totalCount: 3, todayCount: 3 });
    expect(bundleAfterFailure?.facets.sources.length).toBeGreaterThan(0);

    await vi.waitFor(() => {
      expect(listConsumer.bundle?.items.find((item) => item.source === 'chatgpt')?.warningFlags).toEqual(
        changed.expected.chat.warningFlags,
      );
    });
    expect(listConsumer.reads).toBe(readsBeforeMutation + 2);
    expect(await readDataRevisionSnapshot()).toEqual(vectorAfterMutation);
    listConsumer.dispose();
  });

  it('distinguishes a Comments canonical-read rejection from authoritative empty and converges by same-vector replay', async () => {
    const fixture = buildBackupV2FixtureEntries();
    await importBackupZipV2Merge(fixture.entries);
    const article = await getConversationBySourceConversationKey(
      fixture.expected.article.source,
      fixture.expected.article.conversationKey,
    );
    const articleId = Number(article?.id);

    const observer = createRealRevisionObserver();
    const commentsConsumer = await mountCommentsConsumerHarness(observer, articleId);
    expect(commentsConsumer.comments).toHaveLength(2);
    const root = commentsConsumer.comments.find((comment) => comment.parentId == null);
    expect(root).toBeTruthy();

    commentsConsumer.failNext();
    const vectorBeforeDelete = await readDataRevisionSnapshot();
    await expect(deleteArticleCommentById(Number(root?.id))).resolves.toBe(true);
    const vectorAfterDelete = await readDataRevisionSnapshot();
    expect(vectorAfterDelete.article_comments).toBe(vectorBeforeDelete.article_comments + 1);

    await vi.waitFor(() => expect(commentsConsumer.failures).toBe(1));
    expect(commentsConsumer.comments).toHaveLength(2);

    await vi.waitFor(() => expect(commentsConsumer.comments).toEqual([]));
    expect(await readDataRevisionSnapshot()).toEqual(vectorAfterDelete);
    const readsAfterConvergence = commentsConsumer.reads;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(commentsConsumer.reads).toBe(readsAfterConvergence);
    commentsConsumer.dispose();
  });
});
