import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import {
  addArticleComment,
  deleteArticleCommentById,
  listArticleCommentsByConversationId,
} from '@services/comments/data/storage';
import { computeNotionCommentsDigest } from '@services/comments/sync/notion-comments-renderer';
import { conversationKinds } from '@services/protocols/conversation-kinds';
import { backgroundStorage } from '@services/conversations/background/storage';
import { __resetConversationStorageStateForTests } from '@services/conversations/data/storage-idb';
import { exportBackupZipV2 } from '@services/sync/backup/export';
import { importBackupZipV2Merge } from '@services/sync/backup/import';
import { __closeDbForTests as closeBackupDbForTests } from '@services/sync/backup/idb';
import { extractZipEntries } from '@services/sync/backup/zip-utils';
import { createNotionSyncOrchestrator } from '@services/sync/notion/notion-sync-orchestrator';
import { normalizeStandaloneImageCaptionLines } from '@services/sync/shared/markdown-image-normalizer';
import { closeDbForTests, openDb } from '../../src/platform/idb/schema';

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('transaction aborted'));
  });
}

async function deleteDb(): Promise<void> {
  await reqToPromise(indexedDB.deleteDatabase('webclipper') as unknown as IDBRequest<unknown>);
}

function mockChromeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  return {
    runtime: { lastError: null as any },
    storage: {
      local: {
        get(keys: any, callback: (result: Record<string, unknown>) => void) {
          if (keys == null) {
            callback({ ...store });
            return;
          }
          const list = Array.isArray(keys) ? keys : [];
          const result: Record<string, unknown> = {};
          for (const key of list) result[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
          callback(result);
        },
        set(payload: Record<string, unknown>, callback: () => void) {
          Object.assign(store, payload || {});
          callback();
        },
        remove(keys: string[], callback: () => void) {
          for (const key of keys || []) delete store[key];
          callback();
        },
      },
    },
    __store: store,
  };
}

async function closeDbCaches(): Promise<void> {
  await closeBackupDbForTests();
  __resetConversationStorageStateForTests();
  closeDbForTests();
}

function fnv1a32(input: unknown): string {
  const text = String(input || '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function articleDigest(markdown: string): string {
  const normalizedMarkdown = normalizeStandaloneImageCaptionLines(String(markdown || '').trim());
  return fnv1a32(JSON.stringify({ markdown: normalizedMarkdown }));
}

async function transferCurrentDbToEmptyDb(): Promise<void> {
  const exported = await exportBackupZipV2();
  const entries = await extractZipEntries(exported.blob);
  await closeDbCaches();
  await deleteDb();
  await importBackupZipV2Merge(entries);
}

async function getOnlyConversationId(): Promise<number> {
  const db = await openDb();
  const transaction = db.transaction(['conversations'], 'readonly');
  const rows = await reqToPromise<any[]>(transaction.objectStore('conversations').getAll() as any);
  await txDone(transaction);
  expect(rows).toHaveLength(1);
  return Number(rows[0]?.id);
}

function createMemoryJobStore() {
  let job: any = null;
  return {
    NOTION_SYNC_JOB_KEY: 'notion_sync_job_test',
    async getJob() {
      return job;
    },
    async setJob(next: any) {
      job = next;
      return true;
    },
    isRunningJob(value: any) {
      return Boolean(value && value.status === 'running');
    },
    async abortRunningJobIfFromOtherInstance() {
      return job;
    },
  };
}

beforeEach(async () => {
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await closeDbCaches();
  await deleteDb();

  const chromeMock = mockChromeStorage({ notion_parent_page_id: 'parent-page' });
  // @ts-expect-error test global
  globalThis.chrome = chromeMock;
  // @ts-expect-error test global
  globalThis.browser = undefined;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await closeDbCaches();
  await deleteDb();
});

describe('backup -> Notion sync continuity', () => {
  it('keeps an already-synced chat at no_changes after a real ZIP transfer', async () => {
    const dbA = await openDb();
    const txA = dbA.transaction(['conversations', 'messages', 'sync_mappings'], 'readwrite');
    const conversationIdA = await reqToPromise<number>(
      txA.objectStore('conversations').add({
        sourceType: 'chat',
        source: 'chatgpt',
        conversationKey: 'chat-round-trip',
        title: 'Already synced chat',
        url: 'https://chatgpt.com/c/chat-round-trip',
        notionPageId: 'page-chat',
        notionPageUrl: 'https://www.notion.so/workspace/page-chat',
        notionWorkspaceSlug: 'workspace',
        warningFlags: [],
        lastCapturedAt: 100,
      }) as any,
    );
    await reqToPromise(
      txA.objectStore('messages').add({
        conversationId: conversationIdA,
        messageKey: 'm1',
        role: 'user',
        contentText: 'hello',
        contentMarkdown: 'hello',
        sequence: 1,
        updatedAt: 100,
      }) as any,
    );
    await reqToPromise(
      txA.objectStore('messages').add({
        conversationId: conversationIdA,
        messageKey: 'm2',
        role: 'assistant',
        contentText: 'world',
        contentMarkdown: 'world',
        sequence: 2,
        updatedAt: 200,
      }) as any,
    );
    await reqToPromise(
      txA.objectStore('sync_mappings').add({
        source: 'chatgpt',
        conversationKey: 'chat-round-trip',
        notionPageId: 'page-chat',
        notionPageUrl: 'https://www.notion.so/workspace/page-chat',
        notionWorkspaceSlug: 'workspace',
        lastSyncedMessageKey: 'm2',
        lastSyncedSequence: 2,
        lastSyncedAt: 1_000,
        lastSyncedMessageUpdatedAt: 200,
        notionSections: {
          conversations: { headingBlockId: 'heading-conversations' },
        },
        notionSectionCursors: {
          conversations: {
            lastSyncedMessageKey: 'm2',
            lastSyncedSequence: 2,
            lastSyncedMessageUpdatedAt: 200,
          },
        },
        updatedAt: 1_001,
      }) as any,
    );
    await txDone(txA);

    await transferCurrentDbToEmptyDb();

    const conversationIdB = await getOnlyConversationId();
    const imported = await backgroundStorage.getSyncMappingByConversation(conversationIdB);
    expect(imported?.mapping).toMatchObject({
      notionPageId: 'page-chat',
      notionSections: { conversations: { headingBlockId: 'heading-conversations' } },
      notionSectionCursors: {
        conversations: {
          lastSyncedMessageKey: 'm2',
          lastSyncedSequence: 2,
          lastSyncedMessageUpdatedAt: 200,
        },
      },
    });

    const kind = conversationKinds.pick(imported?.conversation);
    expect(kind?.id).toBe('chat');
    const desiredProperties = kind!.notion.pageSpec.buildUpdateProperties(imported!.conversation);
    const calls = {
      getPage: 0,
      createPage: 0,
      updatePage: 0,
      appendChildren: 0,
      clearPageChildren: 0,
      messagesToBlocks: 0,
    };

    const orchestrator = createNotionSyncOrchestrator({
      tokenStore: {
        async getToken() {
          return { accessToken: 'test-token' };
        },
      },
      storage: backgroundStorage,
      conversationKinds,
      notionApi: {},
      notionFilesApi: {},
      dbManager: {
        async ensureDatabase() {
          return { databaseId: 'db-chat' };
        },
      },
      syncService: {
        async getPage() {
          calls.getPage += 1;
          return {
            id: 'page-chat',
            url: 'https://www.notion.so/workspace/page-chat',
            properties: desiredProperties,
          };
        },
        async createPageInDatabase() {
          calls.createPage += 1;
          return { id: 'unexpected-created-page' };
        },
        async updatePageProperties() {
          calls.updatePage += 1;
          return {};
        },
        async clearPageChildren() {
          calls.clearPageChildren += 1;
          return {};
        },
        async appendChildren() {
          calls.appendChildren += 1;
          return { results: [] };
        },
        messagesToBlocks() {
          calls.messagesToBlocks += 1;
          return [];
        },
        isPageUsableForDatabase(_page: unknown, databaseId?: string) {
          return databaseId === 'db-chat';
        },
        pageBelongsToDatabase(_page: unknown, databaseId: string) {
          return databaseId === 'db-chat';
        },
        hasExternalImageBlocks() {
          return false;
        },
        async upgradeImageBlocksToFileUploads(_accessToken: string, blocks: any[]) {
          return blocks;
        },
      },
      jobStore: createMemoryJobStore(),
    });

    const result = await orchestrator.syncConversations({
      instanceId: 'integration-test',
      conversationIds: [conversationIdB],
    });

    expect(result).toMatchObject({
      provider: 'notion',
      okCount: 1,
      failCount: 0,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      conversationId: conversationIdB,
      ok: true,
      mode: 'no_changes',
      appended: 0,
    });
    expect(calls).toEqual({
      getPage: 1,
      createPage: 0,
      updatePage: 0,
      appendChildren: 0,
      clearPageChildren: 0,
      messagesToBlocks: 0,
    });

    const afterSync = await backgroundStorage.getSyncMappingByConversation(conversationIdB);
    expect(afterSync?.mapping?.notionSections).toMatchObject({
      conversations: { headingBlockId: 'heading-conversations' },
    });
    expect(afterSync?.mapping?.notionSectionCursors).toMatchObject({
      conversations: {
        lastSyncedMessageKey: 'm2',
        lastSyncedSequence: 2,
        lastSyncedMessageUpdatedAt: 200,
      },
    });
  });

  it('keeps an already-synced article and comments at no_changes after a real ZIP transfer', async () => {
    const articleUrl = 'https://example.com/article';
    const articleMarkdown = '# Stable article\n\nBody stays unchanged.';
    const articleSectionDigest = articleDigest(articleMarkdown);

    const dbA = await openDb();
    const txA = dbA.transaction(['conversations', 'messages'], 'readwrite');
    const conversationIdA = await reqToPromise<number>(
      txA.objectStore('conversations').add({
        sourceType: 'article',
        source: 'web',
        conversationKey: 'article-round-trip',
        title: 'Already synced article',
        url: articleUrl,
        notionPageId: 'page-article',
        notionPageUrl: 'https://www.notion.so/workspace/page-article',
        notionWorkspaceSlug: 'workspace',
        warningFlags: [],
        lastCapturedAt: 200,
      }) as any,
    );
    await reqToPromise(
      txA.objectStore('messages').add({
        conversationId: conversationIdA,
        messageKey: 'article_body',
        role: 'article',
        contentText: articleMarkdown,
        contentMarkdown: articleMarkdown,
        sequence: 1,
        updatedAt: 200,
      }) as any,
    );
    await txDone(txA);

    const discardedA = await addArticleComment({
      canonicalUrl: articleUrl,
      conversationId: conversationIdA,
      authorName: 'Discarded A',
      quoteText: '',
      commentText: 'advance local id',
      createdAt: 280,
      updatedAt: 280,
    });
    const discardedB = await addArticleComment({
      canonicalUrl: articleUrl,
      conversationId: conversationIdA,
      authorName: 'Discarded B',
      quoteText: '',
      commentText: 'advance local id again',
      createdAt: 290,
      updatedAt: 290,
    });
    await deleteArticleCommentById(discardedA.id);
    await deleteArticleCommentById(discardedB.id);

    const rootComment = await addArticleComment({
      canonicalUrl: articleUrl,
      conversationId: conversationIdA,
      authorName: 'Alice',
      quoteText: 'Stable quote',
      commentText: 'Stable root comment',
      createdAt: 300,
      updatedAt: 300,
    });
    await addArticleComment({
      canonicalUrl: articleUrl,
      conversationId: conversationIdA,
      parentId: rootComment.id,
      authorName: 'Bob',
      quoteText: '',
      commentText: 'Stable reply',
      createdAt: 310,
      updatedAt: 310,
    });
    const commentsA = await listArticleCommentsByConversationId(conversationIdA);
    expect(commentsA).toHaveLength(2);
    expect(commentsA.map((comment) => comment.id).sort((a, b) => a - b)).toEqual([3, 4]);
    const commentsSectionDigest = computeNotionCommentsDigest(commentsA);

    const dbAMapping = await openDb();
    const mappingTx = dbAMapping.transaction(['sync_mappings'], 'readwrite');
    await reqToPromise(
      mappingTx.objectStore('sync_mappings').add({
        source: 'web',
        conversationKey: 'article-round-trip',
        notionPageId: 'page-article',
        notionPageUrl: 'https://www.notion.so/workspace/page-article',
        notionWorkspaceSlug: 'workspace',
        lastSyncedMessageKey: 'article_body',
        lastSyncedSequence: 1,
        lastSyncedAt: 1_000,
        lastSyncedMessageUpdatedAt: 200,
        notionSections: {
          article: { headingBlockId: 'heading-article' },
          comments: { headingBlockId: 'heading-comments' },
        },
        notionSectionDigests: {
          article: { digest: articleSectionDigest, lastSyncedAt: 1_000 },
          comments: { digest: commentsSectionDigest, lastSyncedAt: 1_000 },
        },
        updatedAt: 1_001,
      }) as any,
    );
    await txDone(mappingTx);

    await transferCurrentDbToEmptyDb();

    const conversationIdB = await getOnlyConversationId();
    const importedComments = await listArticleCommentsByConversationId(conversationIdB);
    expect(importedComments).toHaveLength(2);
    expect(importedComments.map((comment) => comment.id).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(computeNotionCommentsDigest(importedComments)).toBe(commentsSectionDigest);

    const imported = await backgroundStorage.getSyncMappingByConversation(conversationIdB);
    expect(imported?.mapping).toMatchObject({
      notionPageId: 'page-article',
      notionSections: {
        article: { headingBlockId: 'heading-article' },
        comments: { headingBlockId: 'heading-comments' },
      },
      notionSectionDigests: {
        article: { digest: articleSectionDigest },
        comments: { digest: commentsSectionDigest },
      },
    });

    const kind = conversationKinds.pick(imported?.conversation);
    expect(kind?.id).toBe('article');
    const desiredProperties = kind!.notion.pageSpec.buildUpdateProperties({
      ...imported!.conversation,
      commentThreadCount: 1,
    });
    const calls = {
      getPage: 0,
      createPage: 0,
      updatePage: 0,
      appendChildren: 0,
      clearPageChildren: 0,
      messagesToBlocks: 0,
      directNotionHttp: 0,
    };
    vi.stubGlobal('fetch', async () => {
      calls.directNotionHttp += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ results: [], has_more: false, next_cursor: null }),
      } as any;
    });

    const orchestrator = createNotionSyncOrchestrator({
      tokenStore: {
        async getToken() {
          return { accessToken: 'test-token' };
        },
      },
      storage: backgroundStorage,
      conversationKinds,
      notionApi: {},
      notionFilesApi: {},
      dbManager: {
        async ensureDatabase() {
          return { databaseId: 'db-article' };
        },
      },
      syncService: {
        async getPage() {
          calls.getPage += 1;
          return {
            id: 'page-article',
            url: 'https://www.notion.so/workspace/page-article',
            properties: desiredProperties,
          };
        },
        async createPageInDatabase() {
          calls.createPage += 1;
          return { id: 'unexpected-created-page' };
        },
        async updatePageProperties() {
          calls.updatePage += 1;
          return {};
        },
        async clearPageChildren() {
          calls.clearPageChildren += 1;
          return {};
        },
        async appendChildren() {
          calls.appendChildren += 1;
          return { results: [] };
        },
        messagesToBlocks() {
          calls.messagesToBlocks += 1;
          return [];
        },
        isPageUsableForDatabase(_page: unknown, databaseId?: string) {
          return databaseId === 'db-article';
        },
        pageBelongsToDatabase(_page: unknown, databaseId: string) {
          return databaseId === 'db-article';
        },
        hasExternalImageBlocks() {
          return false;
        },
        async upgradeImageBlocksToFileUploads(_accessToken: string, blocks: any[]) {
          return blocks;
        },
      },
      jobStore: createMemoryJobStore(),
    });

    const result = await orchestrator.syncConversations({
      instanceId: 'integration-test',
      conversationIds: [conversationIdB],
    });

    expect(result).toMatchObject({
      provider: 'notion',
      okCount: 1,
      failCount: 0,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      conversationId: conversationIdB,
      ok: true,
      mode: 'no_changes',
      appended: 0,
    });
    expect(calls).toEqual({
      getPage: 1,
      createPage: 0,
      updatePage: 0,
      appendChildren: 0,
      clearPageChildren: 0,
      messagesToBlocks: 0,
      directNotionHttp: 0,
    });

    const afterSync = await backgroundStorage.getSyncMappingByConversation(conversationIdB);
    expect(afterSync?.mapping?.notionSections).toMatchObject({
      article: { headingBlockId: 'heading-article' },
      comments: { headingBlockId: 'heading-comments' },
    });
    expect(afterSync?.mapping?.notionSectionDigests).toMatchObject({
      article: { digest: articleSectionDigest },
      comments: { digest: commentsSectionDigest },
    });
  });
});
