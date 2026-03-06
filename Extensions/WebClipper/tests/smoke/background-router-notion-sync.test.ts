import { describe, expect, it } from 'vitest';
import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { registerNotionSettingsHandlers } from '../../src/sync/notion/settings-background-handlers';
import { registerSyncHandlers } from '../../src/sync/background-handlers';
import { createNotionSyncOrchestrator } from '../../src/sync/notion/notion-sync-orchestrator.ts';
import { conversationKinds } from '../../src/protocols/conversation-kinds.ts';
import { NOTION_SYNC_JOB_KEY } from '../../src/sync/notion/notion-sync-job-store.ts';

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
});
