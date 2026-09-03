import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotionSyncOrchestrator } from '@services/sync/notion/notion-sync-orchestrator.ts';
import { conversationKinds } from '@services/protocols/conversation-kinds.ts';

let notionFetchImpl: ((req: any) => Promise<any>) | null = null;

vi.mock('@services/sync/notion/notion-api.ts', () => {
  const notionFetch = (req: any) => {
    if (!notionFetchImpl) throw new Error('notionFetchImpl not set');
    return notionFetchImpl(req);
  };
  return {
    notionFetch,
  };
});

function mockChromeStorage({ parentPageId = 'parent_page' } = {}) {
  const store: Record<string, unknown> = { notion_parent_page_id: parentPageId };
  return {
    storage: {
      local: {
        get(keys: string[], cb: (res: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of keys) out[k] = store[k] || '';
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb();
        },
        remove(keys: string[], cb: () => void) {
          for (const k of keys || []) delete store[String(k)];
          cb();
        },
      },
    },
  };
}

describe('notion-sync-orchestrator kind routing', () => {
  beforeEach(() => {
    notionFetchImpl = null;
  });

  it('routes chat/article to different dbSpec and avoids AI for article', async () => {
    const ensureCalls: any[] = [];
    const createCalls: any[] = [];
    const updateCalls: any[] = [];

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    let currentJob: any = null;
    const jobStore = {
      getJob: async () => currentJob,
      setJob: async (job: any) => {
        currentJob = job;
        return true;
      },
    };

    const tokenStore = { getToken: async () => ({ accessToken: 't' }) };

    const dbManager = {
      ensureDatabase: async ({ dbSpec }: any) => {
        ensureCalls.push(dbSpec);
        if (dbSpec.storageKey === 'notion_db_id_syncnos_web_articles') return { databaseId: 'db_articles' };
        return { databaseId: 'db_chats' };
      },
    };

    const storage = {
      getSyncMappingByConversation: async (id: number) => {
        if (id === 1) {
          return {
            conversation: {
              id: 1,
              sourceType: 'article',
              title: 'Article 1',
              url: 'https://a',
              author: 'Alice',
              publishedAt: '2026-02-26',
              lastCapturedAt: 1000,
            },
            mapping: null,
          };
        }
        return {
          conversation: {
            id: 2,
            sourceType: 'chat',
            source: 'chatgpt',
            title: 'Chat 2',
            url: 'https://c',
            lastCapturedAt: 2000,
          },
          mapping: null,
        };
      },
      getMessagesByConversationId: async () => [
        { messageKey: 'm1', role: 'assistant', contentText: 'hi', sequence: 1, updatedAt: 1 },
      ],
      getArticleCommentsByConversationId: async (conversationId: number) => {
        if (conversationId !== 1) return [];
        return [
          {
            id: 1,
            parentId: null,
            conversationId: 1,
            canonicalUrl: 'https://a/',
            authorName: null,
            locator: null,
            createdAt: 1,
            updatedAt: 1,
            quoteText: 'q',
            commentText: 'root',
          },
          {
            id: 2,
            parentId: 1,
            conversationId: 1,
            canonicalUrl: 'https://a/',
            authorName: null,
            locator: null,
            createdAt: 2,
            updatedAt: 2,
            quoteText: '',
            commentText: 'reply',
          },
        ];
      },
      setConversationNotionPageId: async () => true,
      setSyncCursor: async () => true,
    };

    const syncService = {
      getPage: async () => {
        throw new Error('not found');
      },
      createPageInDatabase: async (_t: string, req: any) => {
        createCalls.push(req);
        return { id: `p_${req.databaseId}` };
      },
      updatePageProperties: async (_t: string, req: any) => {
        updateCalls.push(req);
        return { ok: true };
      },
      appendChildren: async (_t: string, _blockId: string, blocks: any[]) => {
        const results = Array.isArray(blocks)
          ? blocks.map((_, i) => ({ id: `b_${i}_${Math.random().toString(16).slice(2)}` }))
          : [];
        return { ok: true, results };
      },
      messagesToBlocks: (messages: any[]) => [{ kind: 'blocks', count: messages.length }],
    };

    const orchestrator = createNotionSyncOrchestrator({
      tokenStore,
      storage,
      conversationKinds,
      dbManager,
      syncService,
      jobStore,
    });
    const res = await orchestrator.syncConversations({ conversationIds: [1, 2], instanceId: 'i' });
    expect(res.okCount).toBe(2);

    // Ensure dbSpec-driven ensureDatabase was invoked for both storage keys.
    expect(ensureCalls.some((s) => s.storageKey === 'notion_db_id_syncnos_web_articles')).toBe(true);
    expect(ensureCalls.some((s) => s.storageKey === 'notion_db_id_syncnos_ai_chats')).toBe(true);

    // Create calls should target different databases.
    expect(createCalls.map((c) => c.databaseId).sort()).toEqual(['db_articles', 'db_chats']);

    // Create properties: article should not carry AI; chat should carry AI.
    const articleCreate = createCalls.find((c) => c.databaseId === 'db_articles');
    const chatCreate = createCalls.find((c) => c.databaseId === 'db_chats');
    expect(articleCreate.properties.AI).toBeUndefined();
    expect(articleCreate.properties.Author).toBeTruthy();
    expect(articleCreate.properties['Comment Threads']).toEqual({ number: 1 });
    expect(chatCreate.properties.AI).toBeTruthy();

    // Update properties only happen on subsequent syncs; keep coverage minimal here.
    expect(updateCalls.length).toBe(0);
  });

  it('rebuilds article section when digest changes', async () => {
    const calls: any[] = [];

    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    let currentJob: any = null;
    const jobStore = {
      getJob: async () => currentJob,
      setJob: async (job: any) => {
        currentJob = job;
        return true;
      },
    };

    const tokenStore = { getToken: async () => ({ accessToken: 't' }) };

    const dbManager = { ensureDatabase: async () => ({ databaseId: 'db_articles' }) };

    const storage = {
      getSyncMappingByConversation: async () => ({
        conversation: {
          id: 1,
          sourceType: 'article',
          title: 'A',
          url: 'https://a',
          lastCapturedAt: 1000,
          notionPageId: 'p1',
        },
        mapping: {
          notionPageId: 'p1',
          notionSections: { article: { headingBlockId: 'h_article' } },
          notionSectionDigests: { article: { digest: 'old' } },
        },
      }),
      getMessagesByConversationId: async () => [
        {
          messageKey: 'article_body',
          role: 'assistant',
          contentText: 'v2',
          contentMarkdown: 'v2',
          sequence: 1,
          updatedAt: 2000,
        },
      ],
      setConversationNotionPageId: async () => true,
      setSyncCursor: async () => true,
    };

    notionFetchImpl = async (req: any) => {
      calls.push({ op: 'fetch', req });
      if (req.method === 'DELETE' && req.path === '/v1/blocks/h_article') return { ok: true };
      throw new Error(`unexpected notionFetch: ${req.method} ${req.path}`);
    };

    const syncService = {
      getPage: async () => ({
        id: 'p1',
        parent: { type: 'database_id', database_id: 'db_articles' },
        archived: false,
        in_trash: false,
      }),
      isPageUsableForDatabase: () => true,
      updatePageProperties: async (_t: string, req: any) => {
        calls.push({ op: 'updateProps', req });
        return { ok: true };
      },
      appendChildren: async (_t: string, blockId: string, blocks: any[]) => {
        calls.push({ op: 'append', blockId, count: Array.isArray(blocks) ? blocks.length : 0 });
        const results = Array.isArray(blocks) ? blocks.map((_, i) => ({ id: `${blockId}_c_${i}` })) : [];
        return { ok: true, results };
      },
      messagesToBlocks: () => [{ kind: 'blocks', count: 1 }],
    };

    const orchestrator = createNotionSyncOrchestrator({
      tokenStore,
      storage,
      conversationKinds,
      dbManager,
      syncService,
      jobStore,
    });
    const res = await orchestrator.syncConversations({ conversationIds: [1], instanceId: 'i' });
    expect(res.okCount).toBe(1);
    expect(res.results[0].mode).toBe('rebuilt');
    expect(calls.some((c) => c.op === 'fetch' && c.req?.method === 'DELETE')).toBe(true);
    expect(calls.some((c) => c.op === 'append')).toBe(true);
  });

  it('preserves the conversation title when a failure happens after local identity is loaded', async () => {
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    let currentJob: any = null;
    const jobStore = {
      getJob: async () => currentJob,
      setJob: async (job: any) => {
        currentJob = job;
        return true;
      },
    };

    const orchestrator = createNotionSyncOrchestrator({
      tokenStore: { getToken: async () => ({ accessToken: 't' }) },
      storage: {
        getSyncMappingByConversation: async () => ({
          conversation: {
            id: 7,
            sourceType: 'chat',
            source: 'chatgpt',
            title: 'Notion title survives',
            url: 'https://example.com/7',
          },
          mapping: null,
        }),
        getMessagesByConversationId: async () => [],
      },
      conversationKinds,
      dbManager: {
        ensureDatabase: async () => {
          throw new Error('forced database failure');
        },
      },
      syncService: {
        createPageInDatabase: async () => ({ id: 'unused' }),
        appendChildren: async () => ({ ok: true, results: [] }),
        messagesToBlocks: () => [],
      },
      jobStore,
    });

    const result = await orchestrator.syncConversations({ conversationIds: [7], instanceId: 'i' });

    expect(result.failCount).toBe(1);
    expect(result.results[0]).toMatchObject({
      conversationId: 7,
      conversationTitle: 'Notion title survives',
      ok: false,
      mode: 'failed',
      error: 'forced database failure',
    });
    expect(currentJob).toMatchObject({ status: 'done', okCount: 0, failCount: 1 });
    expect(currentJob?.perConversation?.[0]).toMatchObject({
      conversationId: 7,
      conversationTitle: 'Notion title survives',
      ok: false,
      mode: 'failed',
      error: 'forced database failure',
    });
  });

  it('persists a terminal failure job when Notion preflight fails before loading conversations', async () => {
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    let currentJob: any = null;
    const jobStore = {
      getJob: async () => currentJob,
      setJob: async (job: any) => {
        currentJob = job;
        return true;
      },
    };

    const orchestrator = createNotionSyncOrchestrator({
      tokenStore: { getToken: async () => null },
      storage: {
        getSyncMappingByConversation: async () => null,
        getMessagesByConversationId: async () => [],
      },
      conversationKinds,
      dbManager: { ensureDatabase: async () => ({ databaseId: 'unused' }) },
      syncService: {
        createPageInDatabase: async () => ({ id: 'unused' }),
        appendChildren: async () => ({ ok: true, results: [] }),
        messagesToBlocks: () => [],
      },
      jobStore,
    });

    await expect(orchestrator.syncConversations({ conversationIds: [7], instanceId: 'i' })).rejects.toThrow(
      'notion not connected',
    );

    expect(currentJob).toMatchObject({
      provider: 'notion',
      status: 'done',
      conversationIds: [7],
      okCount: 0,
      failCount: 1,
    });
    expect(currentJob?.currentConversationId).toBeUndefined();
    expect(currentJob?.currentConversationTitle).toBeUndefined();
    expect(currentJob?.perConversation).toHaveLength(1);
    expect(currentJob?.perConversation?.[0]).toMatchObject({
      conversationId: 7,
      ok: false,
      mode: 'failed',
      error: 'notion not connected',
    });
  });

  it('rejects fractional conversation ids before durable claim or remote work', async () => {
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    const setJob = vi.fn(async () => true);
    const getToken = vi.fn(async () => ({ accessToken: 't' }));
    const getSyncMappingByConversation = vi.fn(async () => null);
    const ensureDatabase = vi.fn(async () => ({ databaseId: 'unused' }));
    const createPageInDatabase = vi.fn(async () => ({ id: 'unused' }));
    const orchestrator = createNotionSyncOrchestrator({
      tokenStore: { getToken },
      storage: {
        getSyncMappingByConversation,
        getMessagesByConversationId: async () => [],
      },
      conversationKinds,
      dbManager: { ensureDatabase },
      syncService: {
        createPageInDatabase,
        appendChildren: async () => ({ ok: true, results: [] }),
        messagesToBlocks: () => [],
      },
      jobStore: { getJob: async () => null, setJob, abortRunningJob: async () => null },
    } as any);

    await expect(orchestrator.syncConversations({ conversationIds: [1.5], instanceId: 'fractional' })).rejects.toThrow(
      'no conversationIds',
    );
    expect(setJob).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
    expect(getSyncMappingByConversation).not.toHaveBeenCalled();
    expect(ensureDatabase).not.toHaveBeenCalled();
    expect(createPageInDatabase).not.toHaveBeenCalled();
  });

  it('rejects a second direct sync synchronously while the first durable claim is still pending', async () => {
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    let releaseClaim!: (value: boolean) => void;
    const pendingClaim = new Promise<boolean>((resolve) => {
      releaseClaim = resolve;
    });
    const setJob = vi
      .fn()
      .mockImplementationOnce(() => pendingClaim)
      .mockResolvedValue(true);
    const getJob = vi.fn(async () => null);
    const getToken = vi.fn(async () => ({ accessToken: 't' }));
    const ensureDatabase = vi.fn(async () => ({ databaseId: 'unused' }));
    const createPageInDatabase = vi.fn(async () => ({ id: 'unused' }));
    const getSyncMappingByConversation = vi.fn(async () => null);

    const orchestrator = createNotionSyncOrchestrator({
      tokenStore: { getToken },
      storage: {
        getSyncMappingByConversation,
        getMessagesByConversationId: async () => [],
      },
      conversationKinds,
      dbManager: { ensureDatabase },
      syncService: {
        createPageInDatabase,
        appendChildren: async () => ({ ok: true, results: [] }),
        messagesToBlocks: () => [],
      },
      jobStore: { getJob, setJob, abortRunningJob: async () => null },
    } as any);

    const first = orchestrator.syncConversations({ conversationIds: [1], instanceId: 'first' });
    expect(() => orchestrator.syncConversations({ conversationIds: [2], instanceId: 'second' })).toThrowError(
      expect.objectContaining({ code: 'sync_already_running' }),
    );
    expect(getToken).not.toHaveBeenCalled();
    expect(ensureDatabase).not.toHaveBeenCalled();
    expect(createPageInDatabase).not.toHaveBeenCalled();
    expect(getSyncMappingByConversation).not.toHaveBeenCalled();

    releaseClaim(true);
    await first;
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('fails closed on the compact initial claim without a getJob readback or remote work', async () => {
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    const setJob = vi.fn(async () => false);
    const getJob = vi.fn(async () => null);
    const getToken = vi.fn(async () => ({ accessToken: 't' }));
    const ensureDatabase = vi.fn(async () => ({ databaseId: 'unused' }));
    const getSyncMappingByConversation = vi.fn(async () => null);
    const createPageInDatabase = vi.fn(async () => ({ id: 'unused' }));
    const orchestrator = createNotionSyncOrchestrator({
      tokenStore: { getToken },
      storage: {
        getSyncMappingByConversation,
        getMessagesByConversationId: async () => [],
      },
      conversationKinds,
      dbManager: { ensureDatabase },
      syncService: {
        createPageInDatabase,
        appendChildren: async () => ({ ok: true, results: [] }),
        messagesToBlocks: () => [],
      },
      jobStore: { getJob, setJob, abortRunningJob: async () => null },
    } as any);

    await expect(
      orchestrator.syncConversations({ conversationIds: [7], instanceId: 'claim-failure' }),
    ).rejects.toMatchObject({ code: 'notion_sync_job_persist_failed' });
    expect(setJob).toHaveBeenCalledTimes(1);
    expect(setJob.mock.calls[0]?.[0]).toMatchObject({
      provider: 'notion',
      status: 'running',
      totalCount: 1,
      conversationIds: [],
      perConversation: [],
    });
    expect(getJob).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
    expect(getSyncMappingByConversation).not.toHaveBeenCalled();
    expect(ensureDatabase).not.toHaveBeenCalled();
    expect(createPageInDatabase).not.toHaveBeenCalled();
  });

  it('keeps status reads pure and reconciles a running notion residue only through startup maintenance', async () => {
    // @ts-expect-error test global
    globalThis.chrome = mockChromeStorage();

    let currentJob: any = {
      id: 'job_running',
      provider: 'notion',
      instanceId: 'background-old',
      status: 'running',
      startedAt: Date.now() - 3_000,
      updatedAt: Date.now() - 1_000,
      finishedAt: null,
      totalCount: 1,
      conversationIds: [],
      currentConversationId: 1,
      currentStage: 'preparing_sync',
      okCount: 0,
      failCount: 0,
      perConversation: [],
    };
    const jobStore = {
      getJob: async () => currentJob,
      setJob: async (job: any) => {
        currentJob = job;
        return true;
      },
      abortRunningJob: async () => {
        if (currentJob?.status !== 'running') return currentJob;
        currentJob = {
          ...currentJob,
          status: 'aborted',
          updatedAt: Date.now(),
          finishedAt: Date.now(),
          abortedReason: 'extension reloaded',
        };
        return currentJob;
      },
    };

    const orchestrator = createNotionSyncOrchestrator({
      tokenStore: { getToken: async () => ({ accessToken: 't' }) },
      storage: {
        getSyncMappingByConversation: async () => null,
        getMessagesByConversationId: async () => [],
      },
      conversationKinds,
      dbManager: { ensureDatabase: async () => ({ databaseId: 'db_chats' }) },
      syncService: {
        createPageInDatabase: async () => ({ id: 'p1' }),
        appendChildren: async () => ({ ok: true, results: [] }),
        messagesToBlocks: () => [],
      },
      jobStore,
    });

    const status = await orchestrator.getSyncJobStatus({ instanceId: 'background-new' });
    expect(status.job?.status).toBe('running');

    await orchestrator.reconcileStartupSyncJob();
    const reconciled = await orchestrator.getSyncJobStatus({ instanceId: 'background-new' });
    expect(reconciled.job?.status).toBe('aborted');
    expect(reconciled.job?.abortedReason).toBe('extension reloaded');
  });
});
