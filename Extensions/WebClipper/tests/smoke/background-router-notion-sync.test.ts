import { describe, expect, it, vi } from 'vitest';
import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { registerNotionSettingsHandlers } from '../../src/sync/notion/settings-background-handlers';
import { registerSyncHandlers } from '../../src/sync/background-handlers';
import { createNotionSyncOrchestrator } from '../../src/sync/notion/notion-sync-orchestrator.ts';
import { conversationKinds } from '../../src/protocols/conversation-kinds.ts';
import { NOTION_SYNC_JOB_KEY } from '../../src/sync/notion/notion-sync-job-store.ts';
import { notionFetch } from '../../src/sync/notion/notion-api.ts';

function mockChromeStorage({ parentPageId = 'parent_page' } = {}) {
  const store: Record<string, unknown> = { notion_parent_page_id: parentPageId };
  const removed: string[][] = [];
  return {
    storage: {
      local: {
        get(keys: string[], cb: (res: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of keys) {
            if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
            else out[k] = null;
          }
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb();
        },
        remove(keys: string[], cb: () => void) {
          const arr = Array.isArray(keys) ? keys : [];
          removed.push(arr.slice());
          for (const k of arr) delete store[k];
          cb();
        },
      },
    },
    __removed: removed,
    __store: store,
  };
}

function createInMemoryJobStore() {
  let job: any = null;
  return {
    NOTION_SYNC_JOB_KEY,
    getJob: async () => job,
    setJob: async (next: any) => {
      job = next;
      return true;
    },
    isRunningJob: (value: any) => !!value && value.status === 'running',
    abortRunningJobIfFromOtherInstance: async () => job,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function createDelayedJobStore() {
  let job: any = null;
  const runningCounts: number[] = [];
  return {
    NOTION_SYNC_JOB_KEY,
    runningCounts,
    getJob: async () => job,
    setJob: async (next: any) => {
      const count = Array.isArray(next?.perConversation) ? next.perConversation.length : 0;
      const delayMs = next?.status === 'running' && count === 0 ? 20 : 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      job = next;
      if (next?.status === 'running') runningCounts.push(count);
      return true;
    },
    isRunningJob: (value: any) => !!value && value.status === 'running',
    abortRunningJobIfFromOtherInstance: async () => job,
  };
}

function createRouter({
  chromeMock,
  notionServices,
  instanceId = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`,
}: {
  chromeMock: any;
  notionServices: any;
  instanceId?: string;
}) {
  // @ts-expect-error test global
  globalThis.chrome = chromeMock;

  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });

  const notionSyncOrchestrator = createNotionSyncOrchestrator({
    ...notionServices,
    conversationKinds,
    notionApi: {},
    notionFilesApi: {},
  });

  registerNotionSettingsHandlers(router as any, {
    notionSyncJobStore: notionServices.jobStore,
    conversationKinds,
  });

  registerSyncHandlers(router as any, {
      getInstanceId: () => instanceId,
      notionSyncOrchestrator,
      obsidianSyncOrchestrator: {
        getSyncStatus: async () => ({ job: null }),
        clearSyncStatus: async () => ({ job: null }),
        syncConversations: async () => ({ okCount: 0, failCount: 0, results: [] }),
      },
    });

  return router;
}

describe('background-router notion sync', () => {
  it('disconnect clears notion token and cached notion routing keys', async () => {
    const chromeMock = mockChromeStorage();
    chromeMock.storage.local.set(
      {
        notion_oauth_token_v1: {
          accessToken: 't',
          workspaceId: 'w',
          workspaceName: 'ws',
          createdAt: Date.now(),
        },
      },
      () => {},
    );

    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => null },
        storage: null,
        dbManager: null,
        syncService: null,
        jobStore: { NOTION_SYNC_JOB_KEY },
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionDisconnect' });
    expect(res.ok).toBe(true);

    const removedFlatten = chromeMock.__removed.flat();
    expect(removedFlatten).toContain('notion_oauth_token_v1');
    expect(removedFlatten).toContain('notion_parent_page_id');
    expect(removedFlatten).toContain('notion_db_id_syncnos_ai_chats');
    expect(removedFlatten).toContain('notion_db_id_syncnos_web_articles');
    expect(removedFlatten).toContain('notion_oauth_pending_state');
    expect(removedFlatten).toContain('notion_oauth_last_error');
    expect(removedFlatten).toContain('notion_sync_job_v1');
  });

  it('recreates page when existing page is missing', async () => {
    const calls: any[] = [];
    const chromeMock = mockChromeStorage();

    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db1' }) },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: { id: 1, title: 'Hello', url: 'https://x', source: 'chatgpt', notionPageId: 'p_old' },
            mapping: { notionPageId: 'p_old', lastSyncedMessageKey: 'm0' },
          }),
          getMessagesByConversationId: async () => [{ messageKey: 'm1', role: 'user', contentText: 'hi', sequence: 1 }],
          setConversationNotionPageId: async (_id: number, pageId: string) => calls.push({ op: 'setPageId', pageId }),
          setSyncCursor: async (_id: number, cursor: any) => calls.push({ op: 'setCursor', cursor }),
        },
        syncService: {
          getPage: async () => {
            throw new Error('notion api failed: GET /v1/pages/p_old HTTP 404');
          },
          createPageInDatabase: async () => ({ id: 'p_new' }),
          updatePageProperties: async () => ({ ok: true }),
          clearPageChildren: async () => ({ ok: true }),
          appendChildren: async (_t: string, _pageId: string, _blocks: any[]) => {
            calls.push({ op: 'append', pageId: _pageId });
            return { ok: true };
          },
          messagesToBlocks: (messages: any[]) => [{ kind: 'blocks', count: messages.length }],
          isPageUsableForDatabase: () => false,
          pageBelongsToDatabase: () => false,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.okCount).toBe(1);
    expect(res.data.results[0].mode).toBe('created');
    expect(calls.some((c) => c.op === 'setPageId' && c.pageId === 'p_new')).toBe(true);
    expect(calls.some((c) => c.op === 'append' && c.pageId === 'p_new')).toBe(true);
    expect(calls.some((c) => c.op === 'setCursor')).toBe(true);
  });

  it('appends only new messages when cursor matches', async () => {
    const calls: any[] = [];
    const chromeMock = mockChromeStorage();

    let blocksFromCount = 0;
    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db1' }) },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: { id: 1, title: 'Hello', url: 'https://x', source: 'chatgpt', notionPageId: 'p1' },
            mapping: { notionPageId: 'p1', lastSyncedMessageKey: 'm1' },
          }),
          getMessagesByConversationId: async () => [
            { messageKey: 'm1', role: 'user', contentText: 'hi', sequence: 1 },
            { messageKey: 'm2', role: 'assistant', contentText: 'yo', sequence: 2 },
          ],
          setSyncCursor: async () => calls.push({ op: 'setCursor' }),
        },
        syncService: {
          getPage: async () => ({ parent: { type: 'database_id', database_id: 'db1' }, archived: false }),
          updatePageProperties: async () => ({ ok: true }),
          clearPageChildren: async () => calls.push({ op: 'clear' }),
          appendChildren: async (_t: string, _pageId: string, _blocks: any[]) => {
            calls.push({ op: 'append', blocks: _blocks });
            return { ok: true };
          },
          messagesToBlocks: (messages: any[]) => {
            blocksFromCount = messages.length;
            return [{ kind: 'blocks', count: messages.length }];
          },
          isPageUsableForDatabase: () => true,
          pageBelongsToDatabase: () => true,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.results[0].mode).toBe('appended');
    expect(blocksFromCount).toBe(1);
    expect(calls.some((c) => c.op === 'clear')).toBe(false);
    expect(calls.some((c) => c.op === 'append')).toBe(true);
  });

  it('updates page properties without rebuilding body when article content is unchanged', async () => {
    const calls: any[] = [];
    const chromeMock = mockChromeStorage();

    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db_articles' }) },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: {
              id: 1,
              sourceType: 'article',
              title: 'Updated article title',
              url: 'https://x/article',
              description: 'new description only',
              notionPageId: 'p1',
            },
            mapping: {
              notionPageId: 'p1',
              lastSyncedMessageKey: 'article_body',
              lastSyncedMessageUpdatedAt: 1000,
            },
          }),
          getMessagesByConversationId: async () => [
            {
              messageKey: 'article_body',
              role: 'assistant',
              contentText: 'same body',
              contentMarkdown: 'same body',
              sequence: 1,
              updatedAt: 1000,
            },
          ],
          setSyncCursor: async (_id: number, cursor: any) => {
            calls.push({ op: 'setCursor', cursor });
            return true;
          },
        },
        syncService: {
          getPage: async () => ({
            parent: { type: 'database_id', database_id: 'db_articles' },
            archived: false,
            properties: {
              Name: { title: [{ plain_text: 'Old article title' }] },
              URL: { url: 'https://x/article' },
              Author: { rich_text: [] },
              Published: { rich_text: [] },
              Description: { rich_text: [{ plain_text: 'old description' }] },
            },
          }),
          updatePageProperties: async (_t: string, req: any) => {
            calls.push({ op: 'updateProps', req });
            return { ok: true };
          },
          clearPageChildren: async () => {
            calls.push({ op: 'clear' });
            return { ok: true };
          },
          appendChildren: async () => {
            calls.push({ op: 'append' });
            return { ok: true };
          },
          messagesToBlocks: (messages: any[]) => [{ kind: 'blocks', count: messages.length }],
          isPageUsableForDatabase: () => true,
          pageBelongsToDatabase: () => true,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.results[0].mode).toBe('updated_properties');
    expect(calls.some((c) => c.op === 'updateProps')).toBe(true);
    expect(calls.some((c) => c.op === 'clear')).toBe(false);
    expect(calls.some((c) => c.op === 'append')).toBe(false);
    expect(calls.some((c) => c.op === 'setCursor')).toBe(true);
  });

  it('updates notion page title for chats without rebuilding when only metadata changed', async () => {
    const calls: any[] = [];
    const chromeMock = mockChromeStorage();

    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db_chats' }) },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: {
              id: 1,
              source: 'chatgpt',
              title: 'Renamed chat title',
              url: 'https://x/chat',
              notionPageId: 'p1',
            },
            mapping: {
              notionPageId: 'p1',
              lastSyncedMessageKey: 'm1',
              lastSyncedMessageUpdatedAt: 1000,
            },
          }),
          getMessagesByConversationId: async () => [
            {
              messageKey: 'm1',
              role: 'assistant',
              contentText: 'same body',
              sequence: 1,
              updatedAt: 1000,
            },
          ],
          setSyncCursor: async (_id: number, cursor: any) => {
            calls.push({ op: 'setCursor', cursor });
            return true;
          },
        },
        syncService: {
          getPage: async () => ({
            parent: { type: 'database_id', database_id: 'db_chats' },
            archived: false,
            properties: {
              Name: { title: [{ plain_text: 'Old chat title' }] },
              URL: { url: 'https://x/chat' },
              AI: { multi_select: [{ name: 'ChatGPT' }] },
            },
          }),
          updatePageProperties: async (_t: string, req: any) => {
            calls.push({ op: 'updateProps', req });
            return { ok: true };
          },
          clearPageChildren: async () => {
            calls.push({ op: 'clear' });
            return { ok: true };
          },
          appendChildren: async () => {
            calls.push({ op: 'append' });
            return { ok: true };
          },
          messagesToBlocks: (messages: any[]) => [{ kind: 'blocks', count: messages.length }],
          isPageUsableForDatabase: () => true,
          pageBelongsToDatabase: () => true,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.results[0].mode).toBe('updated_properties');
    expect(calls.some((c) => c.op === 'updateProps')).toBe(true);
    expect(calls.some((c) => c.op === 'clear')).toBe(false);
    expect(calls.some((c) => c.op === 'append')).toBe(false);
  });

  it('does not rebuild when messageKey drifts but sequence cursor matches', async () => {
    const calls: any[] = [];
    const chromeMock = mockChromeStorage();

    let blocksFromCount = 0;
    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db1' }) },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: { id: 1, title: 'Hello', url: 'https://x', source: 'chatgpt', notionPageId: 'p1' },
            mapping: { notionPageId: 'p1', lastSyncedMessageKey: 'old_key', lastSyncedSequence: 1 },
          }),
          getMessagesByConversationId: async () => [
            { messageKey: 'new_key', role: 'user', contentText: 'hi', sequence: 1, updatedAt: 1 },
            { messageKey: 'm2', role: 'assistant', contentText: 'yo', sequence: 2, updatedAt: 2 },
          ],
          setSyncCursor: async () => calls.push({ op: 'setCursor' }),
        },
        syncService: {
          getPage: async () => ({ parent: { type: 'database_id', database_id: 'db1' }, archived: false, properties: {} }),
          updatePageProperties: async () => ({ ok: true }),
          clearPageChildren: async () => calls.push({ op: 'clear' }),
          appendChildren: async (_t: string, _pageId: string, _blocks: any[]) => {
            calls.push({ op: 'append', blocks: _blocks });
            return { ok: true };
          },
          messagesToBlocks: (messages: any[]) => {
            blocksFromCount = messages.length;
            return [{ kind: 'blocks', count: messages.length }];
          },
          isPageUsableForDatabase: () => true,
          pageBelongsToDatabase: () => true,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.results[0].mode).toBe('appended');
    expect(blocksFromCount).toBe(1);
    expect(calls.some((c) => c.op === 'clear')).toBe(false);
    expect(calls.some((c) => c.op === 'append')).toBe(true);
  });

  it('keeps no_changes when neither body nor page properties changed', async () => {
    const calls: any[] = [];
    const chromeMock = mockChromeStorage();

    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db_articles' }) },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: {
              id: 1,
              sourceType: 'article',
              title: 'Same article title',
              url: 'https://x/article',
              description: 'same description',
              notionPageId: 'p1',
            },
            mapping: {
              notionPageId: 'p1',
              lastSyncedMessageKey: 'article_body',
              lastSyncedMessageUpdatedAt: 1000,
            },
          }),
          getMessagesByConversationId: async () => [
            {
              messageKey: 'article_body',
              role: 'assistant',
              contentText: 'same body',
              contentMarkdown: 'same body',
              sequence: 1,
              updatedAt: 1000,
            },
          ],
          setSyncCursor: async (_id: number, cursor: any) => {
            calls.push({ op: 'setCursor', cursor });
            return true;
          },
        },
        syncService: {
          getPage: async () => ({
            parent: { type: 'database_id', database_id: 'db_articles' },
            archived: false,
            properties: {
              Name: { title: [{ plain_text: 'Same article title' }] },
              URL: { url: 'https://x/article' },
              Author: { rich_text: [] },
              Published: { rich_text: [] },
              Description: { rich_text: [{ plain_text: 'same description' }] },
            },
          }),
          updatePageProperties: async (_t: string, req: any) => {
            calls.push({ op: 'updateProps', req });
            return { ok: true };
          },
          clearPageChildren: async () => {
            calls.push({ op: 'clear' });
            return { ok: true };
          },
          appendChildren: async () => {
            calls.push({ op: 'append' });
            return { ok: true };
          },
          messagesToBlocks: (messages: any[]) => [{ kind: 'blocks', count: messages.length }],
          isPageUsableForDatabase: () => true,
          pageBelongsToDatabase: () => true,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.results[0].mode).toBe('no_changes');
    expect(calls.some((c) => c.op === 'updateProps')).toBe(false);
    expect(calls.some((c) => c.op === 'clear')).toBe(false);
    expect(calls.some((c) => c.op === 'append')).toBe(false);
    expect(calls.some((c) => c.op === 'setCursor')).toBe(true);
  });

  it('processes conversations with limited concurrency and keeps result order stable', async () => {
    const chromeMock = mockChromeStorage();
    const blockers = new Map<number, ReturnType<typeof deferred<void>>>([
      [1, deferred<void>()],
      [2, deferred<void>()],
      [3, deferred<void>()],
    ]);
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db1' }) },
        storage: {
          getSyncMappingByConversation: async (conversationId: number) => ({
            conversation: {
              id: conversationId,
              title: `Hello ${conversationId}`,
              url: `https://x/${conversationId}`,
              source: 'chatgpt',
              notionPageId: `p_${conversationId}`,
            },
            mapping: { notionPageId: `p_${conversationId}`, lastSyncedMessageKey: `m0_${conversationId}` },
          }),
          getMessagesByConversationId: async (conversationId: number) => [
            { messageKey: `m0_${conversationId}`, role: 'user', contentText: 'old', sequence: 1 },
            { messageKey: `m1_${conversationId}`, role: 'assistant', contentText: 'new', sequence: 2 },
          ],
          setSyncCursor: async () => true,
        },
        syncService: {
          getPage: async () => ({ parent: { type: 'database_id', database_id: 'db1' }, archived: false }),
          updatePageProperties: async () => ({ ok: true }),
          clearPageChildren: async () => ({ ok: true }),
          appendChildren: async (_t: string, pageId: string) => {
            const conversationId = Number(String(pageId).split('_')[1]);
            started.push(conversationId);
            active += 1;
            maxActive = Math.max(maxActive, active);
            const blocker = blockers.get(conversationId);
            if (blocker) await blocker.promise;
            active -= 1;
            return { ok: true };
          },
          messagesToBlocks: (messages: any[]) => [{ kind: 'blocks', count: messages.length }],
          isPageUsableForDatabase: () => true,
          pageBelongsToDatabase: () => true,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const syncPromise = router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1, 2, 3] });

    await waitFor(() => started.length === 2, 'two active conversations');
    expect(started).toEqual([1, 2]);
    expect(maxActive).toBe(2);

    blockers.get(1)!.resolve();
    await waitFor(() => started.includes(3), 'third conversation to start');

    blockers.get(2)!.resolve();
    blockers.get(3)!.resolve();

    const res = await syncPromise;
    expect(res.ok).toBe(true);
    expect(maxActive).toBe(2);
    expect(res.data.results.map((row: any) => row.conversationId)).toEqual([1, 2, 3]);
    expect(res.data.results.every((row: any) => row.ok)).toBe(true);
  });

  it('keeps running job progress monotonic when concurrent workers write status updates', async () => {
    vi.useFakeTimers();
    const chromeMock = mockChromeStorage();
    try {
      // @ts-expect-error test global
      globalThis.chrome = chromeMock;
      const delayedJobStore = createDelayedJobStore();
      const orchestrator = createNotionSyncOrchestrator({
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db1' }) },
        storage: {
          getSyncMappingByConversation: async (conversationId: number) => ({
            conversation: {
              id: conversationId,
              title: `Hello ${conversationId}`,
              url: `https://x/${conversationId}`,
              source: 'chatgpt',
              notionPageId: `p_${conversationId}`,
            },
            mapping: { notionPageId: `p_${conversationId}`, lastSyncedMessageKey: `m0_${conversationId}` },
          }),
          getMessagesByConversationId: async (conversationId: number) => [
            { messageKey: `m0_${conversationId}`, role: 'user', contentText: 'old', sequence: 1 },
            { messageKey: `m1_${conversationId}`, role: 'assistant', contentText: 'new', sequence: 2 },
          ],
          setSyncCursor: async () => true,
        },
        syncService: {
          getPage: async () => ({ parent: { type: 'database_id', database_id: 'db1' }, archived: false }),
          updatePageProperties: async () => ({ ok: true }),
          clearPageChildren: async () => ({ ok: true }),
          appendChildren: async () => ({ ok: true }),
          messagesToBlocks: (messages: any[]) => [{ kind: 'blocks', count: messages.length }],
          isPageUsableForDatabase: () => true,
          pageBelongsToDatabase: () => true,
        },
        jobStore: delayedJobStore,
        conversationKinds,
        notionApi: {},
        notionFilesApi: {},
      } as any);

      const syncPromise = orchestrator.syncConversations({ conversationIds: [1, 2], instanceId: 'status-test' });
      await vi.runAllTimersAsync();
      const result = await syncPromise;

      expect(result.okCount).toBe(2);
      const runningCounts = delayedJobStore.runningCounts;
      for (let i = 1; i < runningCounts.length; i += 1) {
        expect(runningCounts[i]).toBeGreaterThanOrEqual(runningCounts[i - 1]);
      }
    } finally {
      vi.useRealTimers();
      delete (globalThis as any).chrome;
    }
  });

  it('rebuilds when cursor is missing but page exists', async () => {
    const calls: any[] = [];
    const chromeMock = mockChromeStorage();

    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db1' }) },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: { id: 1, title: 'Hello', url: 'https://x', source: 'chatgpt', notionPageId: 'p1' },
            mapping: { notionPageId: 'p1' },
          }),
          getMessagesByConversationId: async () => [{ messageKey: 'm1', role: 'user', contentText: 'hi', sequence: 1 }],
          setSyncCursor: async () => calls.push({ op: 'setCursor' }),
        },
        syncService: {
          getPage: async () => ({ parent: { type: 'database_id', database_id: 'db1' }, archived: false }),
          updatePageProperties: async () => ({ ok: true }),
          clearPageChildren: async () => calls.push({ op: 'clear' }),
          appendChildren: async () => calls.push({ op: 'append' }),
          messagesToBlocks: (messages: any[]) => [{ kind: 'blocks', count: messages.length }],
          isPageUsableForDatabase: () => true,
          pageBelongsToDatabase: () => true,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.results[0].mode).toBe('rebuilt');
    expect(calls.some((c) => c.op === 'clear')).toBe(true);
    expect(calls.some((c) => c.op === 'append')).toBe(true);
  });

  it('exposes sync job status for popup recovery', async () => {
    const chromeMock = mockChromeStorage();

    const jobStore = createInMemoryJobStore();
    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db1' }) },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: { id: 1, title: 'Hello', url: 'https://x', source: 'chatgpt' },
            mapping: null,
          }),
          getMessagesByConversationId: async () => [{ messageKey: 'm1', role: 'user', contentText: 'hi', sequence: 1 }],
          setConversationNotionPageId: async () => true,
          setSyncCursor: async () => true,
        },
        syncService: {
          getPage: async () => {
            throw new Error('404');
          },
          createPageInDatabase: async () => ({ id: 'p_new' }),
          updatePageProperties: async () => ({ ok: true }),
          clearPageChildren: async () => ({ ok: true }),
          appendChildren: async () => ({ ok: true }),
          messagesToBlocks: (messages: any[]) => [{ kind: 'blocks', count: messages.length }],
          isPageUsableForDatabase: () => false,
          pageBelongsToDatabase: () => false,
        },
        jobStore,
      },
    });

    const syncRes = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(syncRes.ok).toBe(true);

    const jobRes = await router.__handleMessageForTests({ type: 'getNotionSyncJobStatus' });
    expect(jobRes.ok).toBe(true);
    expect(jobRes.data.job).toBeTruthy();
    expect(jobRes.data.job.status).toBe('done');
    expect(Array.isArray(jobRes.data.job.perConversation)).toBe(true);
  });

  it('upgrades external image blocks to file_upload before append', async () => {
    const calls: any[] = [];
    const chromeMock = mockChromeStorage();

    let appendedBlocks: any[] = [];
    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db1' }) },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: { id: 1, title: 'Hello', url: 'https://x', source: 'chatgpt' },
            mapping: null,
          }),
          getMessagesByConversationId: async () => [
            { messageKey: 'm1', role: 'user', contentText: 'hi', contentMarkdown: '![](https://example.com/a.png)', sequence: 1 },
          ],
          setConversationNotionPageId: async () => true,
          setSyncCursor: async () => true,
        },
        syncService: {
          getPage: async () => {
            throw new Error('404');
          },
          createPageInDatabase: async () => ({ id: 'p_new' }),
          updatePageProperties: async () => ({ ok: true }),
          clearPageChildren: async () => ({ ok: true }),
          appendChildren: async (_t: string, _pageId: string, blocks: any[]) => {
            appendedBlocks = blocks;
            calls.push({ op: 'append', pageId: _pageId });
            return { ok: true };
          },
          messagesToBlocks: () => [
            {
              object: 'block',
              type: 'image',
              image: { type: 'external', external: { url: 'https://example.com/a.png' } },
            },
          ],
          hasExternalImageBlocks: () => true,
          upgradeImageBlocksToFileUploads: async () => [
            {
              object: 'block',
              type: 'image',
              image: { type: 'file_upload', file_upload: { id: 'u1' } },
            },
          ],
          isPageUsableForDatabase: () => false,
          pageBelongsToDatabase: () => false,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(calls.some((c) => c.op === 'append' && c.pageId === 'p_new')).toBe(true);
    expect(appendedBlocks[0]?.image?.type).toBe('file_upload');
    expect(appendedBlocks[0]?.image?.file_upload?.id).toBe('u1');
  });

  it('returns warning when image upload upgrade keeps external images', async () => {
    const chromeMock = mockChromeStorage();

    let appendedBlocks: any[] = [];
    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db1' }) },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: { id: 1, title: 'Hello', url: 'https://x', source: 'chatgpt' },
            mapping: null,
          }),
          getMessagesByConversationId: async () => [
            { messageKey: 'm1', role: 'user', contentText: 'hi', contentMarkdown: '![](https://example.com/a.png)', sequence: 1 },
          ],
          setConversationNotionPageId: async () => true,
          setSyncCursor: async () => true,
        },
        syncService: {
          getPage: async () => {
            throw new Error('404');
          },
          createPageInDatabase: async () => ({ id: 'p_new' }),
          updatePageProperties: async () => ({ ok: true }),
          clearPageChildren: async () => ({ ok: true }),
          appendChildren: async (_t: string, _pageId: string, blocks: any[]) => {
            appendedBlocks = blocks;
            return { ok: true };
          },
          messagesToBlocks: () => [
            {
              object: 'block',
              type: 'image',
              image: { type: 'external', external: { url: 'https://example.com/a.png' } },
            },
          ],
          hasExternalImageBlocks: () => true,
          // Simulate "degraded" behavior: upgrade attempted but image remains external.
          upgradeImageBlocksToFileUploads: async (accessToken: string, blocks: any[]) => blocks,
          isPageUsableForDatabase: () => false,
          pageBelongsToDatabase: () => false,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(appendedBlocks[0]?.image?.type).toBe('external');
    expect(res.data.results[0].warnings?.[0]?.code).toBe('notion_image_upload_degraded');
  });

  it('recovers once by clearing cached database id when create page returns database object_not_found', async () => {
    const createCalls: string[] = [];
    const ensureCalls: string[] = [];
    let clearCacheCalls = 0;
    const chromeMock = mockChromeStorage();

    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: {
          ensureDatabase: async () => {
            if (!ensureCalls.length) {
              ensureCalls.push('db_stale');
              return { databaseId: 'db_stale' };
            }
            ensureCalls.push('db_new');
            return { databaseId: 'db_new' };
          },
          clearCachedDatabaseId: async () => {
            clearCacheCalls += 1;
          },
        },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: { id: 1, title: 'Hello', url: 'https://x', source: 'chatgpt' },
            mapping: null,
          }),
          getMessagesByConversationId: async () => [{ messageKey: 'm1', role: 'user', contentText: 'hi', sequence: 1 }],
          setConversationNotionPageId: async () => true,
          setSyncCursor: async () => true,
        },
        syncService: {
          createPageInDatabase: async (_t: string, payload: any) => {
            createCalls.push(payload.databaseId);
            if (payload.databaseId === 'db_stale') {
              throw new Error(
                'notion api failed: POST /v1/pages HTTP 404 {"code":"object_not_found","message":"Could not find database with ID: db_stale"}',
              );
            }
            return { id: 'p_new' };
          },
          appendChildren: async () => ({ ok: true }),
          messagesToBlocks: () => [{ kind: 'blocks', count: 1 }],
          isPageUsableForDatabase: () => false,
          pageBelongsToDatabase: () => false,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.results[0].mode).toBe('created');
    expect(createCalls).toEqual(['db_stale', 'db_new']);
    expect(ensureCalls).toEqual(['db_stale', 'db_new']);
    expect(clearCacheCalls).toBe(1);
  });

  it('reuses the rebuilt database for later conversations in the same batch after stale database recovery', async () => {
    const createCalls: string[] = [];
    const ensureCalls: string[] = [];
    const chromeMock = mockChromeStorage();

    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: {
          ensureDatabase: async () => {
            if (!ensureCalls.length) {
              ensureCalls.push('db_stale');
              return { databaseId: 'db_stale' };
            }
            ensureCalls.push('db_new');
            return { databaseId: 'db_new' };
          },
          clearCachedDatabaseId: async () => true,
        },
        storage: {
          getSyncMappingByConversation: async (conversationId: number) => ({
            conversation: { id: conversationId, title: `Hello ${conversationId}`, url: `https://x/${conversationId}`, source: 'chatgpt' },
            mapping: null,
          }),
          getMessagesByConversationId: async (conversationId: number) => [
            { messageKey: `m${conversationId}`, role: 'user', contentText: 'hi', sequence: 1 },
          ],
          setConversationNotionPageId: async () => true,
          setSyncCursor: async () => true,
        },
        syncService: {
          createPageInDatabase: async (_t: string, payload: any) => {
            createCalls.push(payload.databaseId);
            if (payload.databaseId === 'db_stale') {
              throw new Error(
                'notion api failed: POST /v1/pages HTTP 404 {"code":"object_not_found","message":"Could not find database with ID: db_stale"}',
              );
            }
            return { id: `p_${createCalls.length}` };
          },
          appendChildren: async () => ({ ok: true }),
          messagesToBlocks: () => [{ kind: 'blocks', count: 1 }],
          isPageUsableForDatabase: () => false,
          pageBelongsToDatabase: () => false,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1, 2] });
    expect(res.ok).toBe(true);
    expect(res.data.okCount).toBe(2);
    expect(createCalls).toEqual(['db_stale', 'db_stale', 'db_new', 'db_new']);
    expect(ensureCalls).toEqual(['db_stale', 'db_new']);
  });

  it('returns structured already-running sync error metadata', async () => {
    const chromeMock = mockChromeStorage();
    const runningJobStore = createInMemoryJobStore();
    await runningJobStore.setJob({
      id: 'job-running',
      provider: 'notion',
      instanceId: 'same-instance',
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      conversationIds: [1],
      okCount: 0,
      failCount: 0,
      perConversation: [],
    });

    const router = createRouter({
      chromeMock,
      instanceId: 'same-instance',
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db1' }) },
        storage: {
          getSyncMappingByConversation: async () => null,
          getMessagesByConversationId: async () => [],
        },
        syncService: {
          createPageInDatabase: async () => ({ id: 'p1' }),
          appendChildren: async () => ({ ok: true }),
          messagesToBlocks: () => [],
        },
        jobStore: runningJobStore,
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe('sync already in progress');
    expect(res.error?.extra?.code).toBe('sync_already_running');
  });

  it('normalizes notion validation errors in per-conversation failures', async () => {
    const chromeMock = mockChromeStorage();

    const router = createRouter({
      chromeMock,
      notionServices: {
        tokenStore: { getToken: async () => ({ accessToken: 't' }) },
        dbManager: { ensureDatabase: async () => ({ databaseId: 'db1' }) },
        storage: {
          getSyncMappingByConversation: async () => ({
            conversation: { id: 1, title: 'Hello', url: 'https://x', source: 'chatgpt' },
            mapping: null,
          }),
          getMessagesByConversationId: async () => [{ messageKey: 'm1', role: 'user', contentText: 'hi', sequence: 1 }],
          setConversationNotionPageId: async () => true,
          setSyncCursor: async () => true,
        },
        syncService: {
          getPage: async () => {
            throw new Error('404');
          },
          createPageInDatabase: async () => ({ id: 'p_new' }),
          appendChildren: async () => {
            const error: any = new Error('notion api failed: PATCH /v1/blocks/p_new/children HTTP 400');
            error.status = 400;
            error.code = 'validation_error';
            error.notionMessage = 'body failed validation: body.children[27].paragraph.rich_text.length should be ≤ `100`, instead was `129`.';
            throw error;
          },
          messagesToBlocks: () => [{ kind: 'blocks', count: 1 }],
          isPageUsableForDatabase: () => false,
          pageBelongsToDatabase: () => false,
        },
        jobStore: createInMemoryJobStore(),
      },
    });

    const res = await router.__handleMessageForTests({ type: 'notionSyncConversations', conversationIds: [1] });
    expect(res.ok).toBe(true);
    expect(res.data.failCount).toBe(1);
    expect(res.data.results[0].error).toBe(
      'Notion rejected one content block because it contained too many rich text fragments. The content needs to be split into smaller blocks.',
    );
  });

  it('parses structured error metadata from Notion API responses', async () => {
    const originalFetch = globalThis.fetch;
    try {
      // @ts-expect-error test global
      globalThis.fetch = vi.fn(async () => ({
        ok: false,
        status: 429,
        headers: { get: (key: string) => (String(key).toLowerCase() === 'retry-after' ? '2' : null) },
        text: async () =>
          JSON.stringify({
            object: 'error',
            status: 429,
            code: 'rate_limited',
            message: 'Too many requests',
            request_id: 'req_123',
          }),
      }));

      await expect(
        notionFetch({ accessToken: 't', method: 'GET', path: '/v1/pages/p1', body: null }),
      ).rejects.toMatchObject({
        status: 429,
        code: 'rate_limited',
        retryAfterMs: 2000,
        requestId: 'req_123',
        notionMessage: 'Too many requests',
      });
    } finally {
      // @ts-expect-error test global
      globalThis.fetch = originalFetch;
    }
  });
});
