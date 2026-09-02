import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncJobStore } from '@services/sync/sync-job-store';

const backgroundStorageMocks = vi.hoisted(() => ({
  getConversationById: vi.fn(),
  getMessagesByConversationId: vi.fn(),
  getArticleCommentsByConversationId: vi.fn(),
  attachOrphanArticleCommentsToConversation: vi.fn(),
  recordObsidianRemoteWrite: vi.fn(),
}));
const imageCacheMocks = vi.hoisted(() => ({ getImageCacheAssetById: vi.fn() }));

vi.mock('@services/conversations/background/storage', () => ({
  backgroundStorage: {
    getConversationById: backgroundStorageMocks.getConversationById,
    getMessagesByConversationId: backgroundStorageMocks.getMessagesByConversationId,
    getArticleCommentsByConversationId: backgroundStorageMocks.getArticleCommentsByConversationId,
    attachOrphanArticleCommentsToConversation: backgroundStorageMocks.attachOrphanArticleCommentsToConversation,
    recordObsidianRemoteWrite: backgroundStorageMocks.recordObsidianRemoteWrite,
  },
}));
vi.mock('@services/conversations/data/image-cache-read', () => imageCacheMocks);

async function loadModule(rel: string) {
  const mod = await import(/* @vite-ignore */ rel);
  return (mod as any).default || mod;
}

function setupChromeStorage({ failSyncJobWrites = false }: { failSyncJobWrites?: boolean } = {}) {
  const store: Record<string, unknown> = {};
  const syncJobSetPayloads: unknown[] = [];
  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys: any, cb: (res: Record<string, unknown>) => void) {
          const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
          const out: Record<string, unknown> = {};
          for (const k of list) out[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          if (Object.prototype.hasOwnProperty.call(payload || {}, 'obsidian_sync_job_v1')) {
            syncJobSetPayloads.push((payload as any).obsidian_sync_job_v1);
            if (failSyncJobWrites) {
              globalThis.chrome.runtime.lastError = { message: 'forced sync job write failure' };
              cb && cb();
              globalThis.chrome.runtime.lastError = null;
              return;
            }
          }
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb && cb();
        },
      },
    },
  };
  return { store, syncJobSetPayloads };
}

beforeEach(() => {
  backgroundStorageMocks.recordObsidianRemoteWrite.mockResolvedValue({ generation: 1 });
});

describe('obsidian-sync-orchestrator', () => {
  it('ignores fractional conversation ids without creating a running job', async () => {
    const { syncJobSetPayloads } = setupChromeStorage();
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    const result = await orch.syncConversations({
      conversationIds: [1.5],
      forceFullConversationIds: [1.5],
      instanceId: 'fractional',
    });

    expect(result).toMatchObject({ okCount: 0, failCount: 0, results: [] });
    expect(syncJobSetPayloads).toEqual([]);
    expect(backgroundStorageMocks.getConversationById).not.toHaveBeenCalled();
  });

  it('reports missing_api_key when api key is not configured', async () => {
    setupChromeStorage();
    await loadModule('@services/sync/obsidian/obsidian-local-rest-client.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    const res = await orch.testConnection({ instanceId: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('missing_api_key');
  });

  it('reports auth_error when server responds authenticated=false', async () => {
    setupChromeStorage();
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    await loadModule('@services/sync/obsidian/obsidian-local-rest-client.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    // @ts-expect-error test global
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ authenticated: false, message: 'unauthorized' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'bad' });
    const res = await orch.testConnection({ instanceId: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('auth_error');
    expect(String(res.error?.message || '')).toContain('unauthorized');
  });

  it('decides full rebuild when remote note is missing (404)', async () => {
    setupChromeStorage();
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    await loadModule('@services/sync/obsidian/obsidian-local-rest-client.ts');
    await loadModule('@services/sync/obsidian/obsidian-note-path.ts');
    await loadModule('@services/sync/shared/remote-markdown-metadata.ts');
    await loadModule('@services/sync/shared/remote-markdown-writer.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'k1',
      title: 't',
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'm1', sequence: 1, contentMarkdown: 'hi', updatedAt: Date.now() },
    ]);

    let _call = 0;
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      _call += 1;
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(JSON.stringify({ errorCode: 40400, message: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ errorCode: 40000, message: 'unexpected' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k' });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(syncRes.results[0].mode).toBe('full_rebuild');
    expect(syncRes.results[0].ok).toBe(true);
  });

  it('keeps best-effort compact persistence before remote work and synchronously rejects a second direct run', async () => {
    const { syncJobSetPayloads } = setupChromeStorage({ failSyncJobWrites: true });
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'best-effort',
      title: 'Best effort',
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'm1', sequence: 1, contentMarkdown: 'body', updatedAt: 1 },
    ]);

    let remoteStarted!: () => void;
    let releaseRemote!: () => void;
    const remoteStartedPromise = new Promise<void>((resolve) => {
      remoteStarted = resolve;
    });
    const remoteGate = new Promise<void>((resolve) => {
      releaseRemote = resolve;
    });
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        remoteStarted();
        await remoteGate;
        return new Response(JSON.stringify({ errorCode: 40400, message: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected:${method}`);
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k' });
    const firstRun = orch.syncConversations({ conversationIds: [1], instanceId: 'first' });
    await remoteStartedPromise;

    expect(orch.isRunActive()).toBe(true);
    expect(syncJobSetPayloads[0]).toMatchObject({
      provider: 'obsidian',
      status: 'running',
      totalCount: 1,
      conversationIds: [],
      perConversation: [],
    });
    expect((await orch.getSyncStatus({ instanceId: 'first' })).job).toBeNull();

    let conflict: unknown = null;
    try {
      orch.syncConversations({ conversationIds: [2], instanceId: 'second' });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toMatchObject({ code: 'sync_already_running' });

    releaseRemote();
    const result = await firstRun;
    expect(result.results[0]).toMatchObject({ conversationId: 1, ok: true, mode: 'full_rebuild' });
    const runningJobs = syncJobSetPayloads.filter((job: any) => job?.status === 'running') as any[];
    expect(
      runningJobs.every(
        (job: any) =>
          job.totalCount === 1 &&
          Array.isArray(job.conversationIds) &&
          job.conversationIds.length === 0 &&
          Array.isArray(job.perConversation) &&
          job.perConversation.length === 0,
      ),
    ).toBe(true);
    expect(
      runningJobs.filter((job: any) => job.currentConversationId === 1 && job.currentStage === 'preparing_sync'),
    ).toHaveLength(1);
    expect(runningJobs.filter((job: any) => Number(job.okCount || 0) + Number(job.failCount || 0) === 1)).toEqual([
      expect.objectContaining({ okCount: 1, failCount: 0, currentConversationId: undefined }),
    ]);
    expect(syncJobSetPayloads.at(-1)).toMatchObject({
      status: 'done',
      conversationIds: [1],
      perConversation: [expect.objectContaining({ conversationId: 1, ok: true })],
    });
    expect(orch.isRunActive()).toBe(false);
    expect((await orch.getSyncStatus({ instanceId: 'first' })).job).toBeNull();
  });

  it('materializes SyncNos image refs through the shared Markdown helper without changing Obsidian naming', async () => {
    setupChromeStorage();
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    const naming = await loadModule('@services/conversations/domain/file-naming.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    const convo = { id: 1, sourceType: 'chat', source: 'chatgpt', conversationKey: 'k1', title: 'Image Note' };
    const noteBasename = naming.buildConversationBasename(convo);
    backgroundStorageMocks.getConversationById.mockResolvedValue(convo);
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      {
        messageKey: 'm1',
        sequence: 1,
        contentMarkdown: 'before\n\n![diagram](<syncnos-asset://7> "caption")\n\nafter',
        updatedAt: 1,
      },
    ]);
    imageCacheMocks.getImageCacheAssetById.mockResolvedValue({
      id: 7,
      conversationId: 1,
      url: 'https://example.com/diagram.png',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      byteSize: 3,
      contentType: 'image/png',
    });

    const seen: Array<{ method: string; url: string; body: unknown }> = [];
    // @ts-expect-error test global
    globalThis.fetch = async (url: any, init: any) => {
      const method = String(init?.method || 'GET').toUpperCase();
      seen.push({ method, url: String(url), body: init?.body });
      if (method === 'GET') {
        return new Response(JSON.stringify({ errorCode: 40400, message: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected:${method}`);
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k' });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(syncRes.results[0].ok).toBe(true);
    expect(imageCacheMocks.getImageCacheAssetById).toHaveBeenCalledWith({ id: 7 });

    const encodedAttachmentName = encodeURIComponent(`${noteBasename}-1.png`);
    const encodedNoteName = encodeURIComponent(`${noteBasename}.md`);
    const binaryPut = seen.find((call) => call.method === 'PUT' && call.url.endsWith(encodedAttachmentName));
    expect(binaryPut?.url).toContain(`/vault/SyncNos-AIChats/${encodedAttachmentName}`);
    const markdownPut = seen.find((call) => call.method === 'PUT' && call.url.endsWith(encodedNoteName));
    expect(String(markdownPut?.body || '')).toContain(`![diagram](<${noteBasename}-1.png> "caption")`);
    expect(String(markdownPut?.body || '')).not.toContain('syncnos-asset://');
  });

  it('does not record generation when only attachments succeed and the main note PUT fails', async () => {
    setupChromeStorage();
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'attachment-only-failure',
      title: 'Attachment only failure',
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      {
        messageKey: 'm1',
        sequence: 1,
        contentMarkdown: '![asset](syncnos-asset://7)',
        updatedAt: 1,
      },
    ]);
    imageCacheMocks.getImageCacheAssetById.mockResolvedValue({
      id: 7,
      conversationId: 1,
      url: 'https://example.com/a.png',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      byteSize: 3,
      contentType: 'image/png',
    });

    let binaryPutCount = 0;
    let notePutCount = 0;
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(JSON.stringify({ errorCode: 40400, message: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'PUT' && typeof init?.body !== 'string') {
        binaryPutCount += 1;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'PUT') {
        notePutCount += 1;
        return new Response(JSON.stringify({ errorCode: 50000, message: 'main put failed' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected:${method}`);
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k' });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });

    expect(binaryPutCount).toBe(1);
    expect(notePutCount).toBe(1);
    expect(syncRes.results[0].ok).toBe(false);
    expect(syncRes.results[0].mode).toBe('failed');
    expect(backgroundStorageMocks.recordObsidianRemoteWrite).not.toHaveBeenCalled();
  });

  it('rebuilds chat note when remote exists', async () => {
    setupChromeStorage();
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    await loadModule('@services/sync/obsidian/obsidian-local-rest-client.ts');
    await loadModule('@services/sync/obsidian/obsidian-note-path.ts');
    await loadModule('@services/sync/shared/remote-markdown-metadata.ts');
    await loadModule('@services/sync/shared/remote-markdown-writer.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'k1',
      title: 't',
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'm1', sequence: 1, contentMarkdown: 'a', updatedAt: 1 },
      { messageKey: 'm2', sequence: 2, contentMarkdown: 'b', updatedAt: 2 },
    ]);

    let putBody = '';
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(
          JSON.stringify({
            frontmatter: {
              syncnos: {
                source: 'chatgpt',
                conversationKey: 'k1',
                schemaVersion: 1,
                lastSyncedSequence: 1,
                lastSyncedMessageKey: 'm1',
              },
            },
            content: '# Conversations\n\n## 1 assistant\n\nhi\n',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (method === 'PUT') {
        putBody = String(init?.body || '');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ errorCode: 40000, message: 'unexpected' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k' });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(syncRes.results[0].mode).toBe('full_rebuild');
    expect(syncRes.results[0].appended).toBe(2);
    expect(syncRes.results[0].ok).toBe(true);
    expect(putBody).toContain('# Conversations');
    expect(putBody).toContain('## 1 assistant');

    const status = await orch.getSyncStatus({ instanceId: 'x' });
    expect(status.job?.status).toBe('done');
  });

  it('keeps status reads side-effect free and reconciles orphan running state only through startup maintenance', async () => {
    setupChromeStorage();
    const jobStore = createSyncJobStore('obsidian');
    await jobStore.setJob({
      id: 'job_running',
      provider: 'obsidian',
      instanceId: 'background-old',
      status: 'running',
      startedAt: Date.now() - 4_000,
      updatedAt: Date.now() - 1_000,
      finishedAt: null,
      conversationIds: [1],
      currentConversationId: 1,
      currentStage: 'writing_full_note',
      okCount: 0,
      failCount: 0,
      perConversation: [],
    });
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    const status = await orch.getSyncStatus({ instanceId: 'background-new' });
    expect(status.job?.status).toBe('running');
    expect((await jobStore.getJob())?.status).toBe('running');

    const reconciled = await orch.reconcileStartupSyncJob();
    expect(reconciled?.status).toBe('aborted');
    expect(reconciled?.abortedReason).toBe('extension reloaded');
    expect((await jobStore.getJob())?.status).toBe('aborted');
  });

  it('rebuilds article note when remote exists', async () => {
    setupChromeStorage();
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    await loadModule('@services/sync/obsidian/obsidian-local-rest-client.ts');
    await loadModule('@services/sync/obsidian/obsidian-note-path.ts');
    await loadModule('@services/sync/shared/remote-markdown-metadata.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    const convo = {
      id: 1,
      sourceType: 'article',
      source: 'goodlinks',
      conversationKey: 'k1',
      title: 't',
      url: 'https://example.com',
    };
    backgroundStorageMocks.getConversationById.mockResolvedValue(convo);
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'article_body', sequence: 1, contentMarkdown: 'Body', updatedAt: 1 },
    ]);
    backgroundStorageMocks.attachOrphanArticleCommentsToConversation.mockResolvedValue({ ok: true });
    backgroundStorageMocks.getArticleCommentsByConversationId.mockResolvedValue([
      {
        id: 1,
        parentId: null,
        conversationId: 1,
        canonicalUrl: 'https://example.com',
        quoteText: 'Quoted',
        commentText: 'Root',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    let putCount = 0;
    let putBody = '';
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(
          JSON.stringify({
            frontmatter: {
              syncnos: {
                source: 'goodlinks',
                conversationKey: 'k1',
                schemaVersion: 1,
                lastSyncedSequence: 1,
                lastSyncedMessageKey: 'article_body',
              },
            },
            content: 'x',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (method === 'PUT') {
        putCount += 1;
        putBody = String(init?.body || '');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ errorCode: 40000, message: 'unexpected' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k' });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(syncRes.results[0].ok).toBe(true);
    expect(syncRes.results[0].mode).toBe('full_rebuild');
    expect(putCount).toBe(1);
    expect(putBody).toContain('## Article');
    expect(putBody).toContain('## Comments');
  });

  it('rebuilds chat note even when remote cursor mismatches', async () => {
    setupChromeStorage();
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    await loadModule('@services/sync/obsidian/obsidian-local-rest-client.ts');
    await loadModule('@services/sync/obsidian/obsidian-note-path.ts');
    await loadModule('@services/sync/shared/remote-markdown-metadata.ts');
    await loadModule('@services/sync/shared/remote-markdown-writer.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'k1',
      title: 't',
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'm1', sequence: 1, contentMarkdown: 'a', updatedAt: 1 },
      { messageKey: 'm2', sequence: 2, contentMarkdown: 'b', updatedAt: 2 },
    ]);

    // Remote syncnos cursor is stale/mismatched.
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(
          JSON.stringify({
            frontmatter: {
              syncnos: {
                source: 'chatgpt',
                conversationKey: 'k1',
                schemaVersion: 1,
                lastSyncedSequence: 1,
                lastSyncedMessageKey: 'm1',
                lastSyncedMessageUpdatedAt: 999,
              },
            },
            content: 'x',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ errorCode: 40000, message: 'unexpected' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k' });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(syncRes.results[0].ok).toBe(true);
    expect(syncRes.results[0].mode).toBe('full_rebuild');
  });

  it('forces full rebuild when remote chat note uses legacy SyncNos::Messages heading', async () => {
    setupChromeStorage();
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    await loadModule('@services/sync/obsidian/obsidian-local-rest-client.ts');
    await loadModule('@services/sync/obsidian/obsidian-note-path.ts');
    await loadModule('@services/sync/shared/remote-markdown-metadata.ts');
    await loadModule('@services/sync/shared/remote-markdown-writer.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'k1',
      title: 't',
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'm1', sequence: 1, contentMarkdown: 'a', updatedAt: 1 },
      { messageKey: 'm2', sequence: 2, contentMarkdown: 'b', updatedAt: 2 },
    ]);

    let patchCount = 0;
    let putBody = '';
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(
          JSON.stringify({
            frontmatter: {
              syncnos: {
                source: 'chatgpt',
                conversationKey: 'k1',
                schemaVersion: 1,
                lastSyncedSequence: 1,
                lastSyncedMessageKey: 'm1',
                lastSyncedMessageUpdatedAt: 1,
              },
            },
            content: '# t\n\n## SyncNos::Messages\n\n#### 1 assistant m1\n\nhi\n',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (method === 'PATCH') {
        patchCount += 1;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'PUT') {
        putBody = String(init?.body || '');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ errorCode: 40000, message: 'unexpected' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k' });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(syncRes.results[0].ok).toBe(true);
    expect(syncRes.results[0].mode).toBe('full_rebuild');
    expect(patchCount).toBe(0);
    expect(putBody).toContain('# Conversations');
    expect(putBody).toContain('## 1 assistant');
  });

  it.each([
    ['generation persistence failure blocks old-path delete', 'record_fail'],
    ['old-path delete throw keeps generation committed', 'delete_throw'],
  ] as const)('%s', async (_label, failureMode) => {
    setupChromeStorage();
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    const naming = await loadModule('@services/conversations/domain/file-naming.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    const convo = {
      id: 1,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: 'rename-failure',
      title: 'New Title',
    };
    const stableId10 = naming.stableConversationId10(convo);
    const oldFilename = `chatgpt-Old Title-${stableId10}.md`;
    const oldFilenameEncoded = oldFilename.replace(/ /g, '%20');
    backgroundStorageMocks.getConversationById.mockResolvedValue(convo);
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'm1', sequence: 1, contentMarkdown: 'hi', updatedAt: 1 },
    ]);
    if (failureMode === 'record_fail') {
      backgroundStorageMocks.recordObsidianRemoteWrite.mockRejectedValue(new Error('generation persist failed'));
    }

    let deleteCalls = 0;
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const url = String(_url || '');
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'GET' && url.endsWith('/vault/SyncNos-AIChats/')) {
        return new Response(JSON.stringify({ files: [oldFilename] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'GET' && url.includes(`/vault/SyncNos-AIChats/${oldFilenameEncoded}`)) {
        return new Response(
          JSON.stringify({
            frontmatter: {
              syncnos: {
                source: 'chatgpt',
                conversationKey: 'rename-failure',
                schemaVersion: 1,
                lastSyncedSequence: 1,
                lastSyncedMessageKey: 'm1',
                lastSyncedMessageUpdatedAt: 1,
              },
            },
            content: 'old',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (method === 'GET') {
        return new Response(JSON.stringify({ errorCode: 40400, message: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'DELETE') {
        deleteCalls += 1;
        if (failureMode === 'delete_throw') throw new Error('forced old path delete throw');
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected:${method}`);
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k' });
    const result = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });

    if (failureMode === 'record_fail') {
      expect(result.results[0]).toMatchObject({ ok: false, mode: 'failed' });
      expect(String(result.results[0].error)).toContain('generation persist failed');
      expect(deleteCalls).toBe(0);
      expect(backgroundStorageMocks.recordObsidianRemoteWrite).toHaveBeenCalledTimes(1);
    } else {
      expect(result.results[0]).toMatchObject({ ok: false, mode: 'rename_delete_failed' });
      expect(String(result.results[0].error)).toContain('forced old path delete throw');
      expect(deleteCalls).toBe(1);
      expect(backgroundStorageMocks.recordObsidianRemoteWrite).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps per-item isolation when one generation commit fails after a successful main note PUT', async () => {
    setupChromeStorage();
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    backgroundStorageMocks.getConversationById.mockImplementation(async (id: number) => ({
      id,
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: `isolation-${id}`,
      title: `Isolation ${id}`,
    }));
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'm1', sequence: 1, contentMarkdown: 'hi', updatedAt: 1 },
    ]);
    backgroundStorageMocks.recordObsidianRemoteWrite
      .mockRejectedValueOnce(new Error('first generation failed'))
      .mockResolvedValueOnce({ generation: 1 });
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(JSON.stringify({ errorCode: 40400, message: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected:${method}`);
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k' });
    const result = await orch.syncConversations({ conversationIds: [1, 2], instanceId: 'x' });

    expect(result.results[0]).toMatchObject({
      conversationId: 1,
      conversationTitle: 'Isolation 1',
      ok: false,
      mode: 'failed',
    });
    expect(String(result.results[0].error)).toContain('first generation failed');
    expect(result.results[1]).toMatchObject({
      conversationId: 2,
      conversationTitle: 'Isolation 2',
      ok: true,
      mode: 'full_rebuild',
    });
    const status = await orch.getSyncStatus({ instanceId: 'x' });
    expect(status.job?.perConversation?.[0]).toMatchObject({
      conversationId: 1,
      conversationTitle: 'Isolation 1',
      ok: false,
      mode: 'failed',
    });
    expect(backgroundStorageMocks.recordObsidianRemoteWrite).toHaveBeenCalledTimes(2);
  });

  it('renames note when title changes by rebuilding new file and deleting old file', async () => {
    setupChromeStorage();
    const settingsStore = await loadModule('@services/sync/obsidian/settings-store.ts');
    await loadModule('@services/sync/obsidian/obsidian-local-rest-client.ts');
    await loadModule('@services/sync/obsidian/obsidian-note-path.ts');
    await loadModule('@services/sync/shared/remote-markdown-metadata.ts');
    await loadModule('@services/sync/shared/remote-markdown-writer.ts');
    const naming = await loadModule('@services/conversations/domain/file-naming.ts');
    const orch = await loadModule('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    const convo = { id: 1, sourceType: 'chat', source: 'chatgpt', conversationKey: 'k1', title: 'New Title' };
    const stableId10 = naming.stableConversationId10(convo);
    const oldFilename = `chatgpt-Old Title-${stableId10}.md`;
    const oldFilenameEncoded = oldFilename.replace(/ /g, '%20');
    const order: string[] = [];
    backgroundStorageMocks.recordObsidianRemoteWrite.mockImplementation(async () => {
      order.push('record');
      return { generation: 1 };
    });

    backgroundStorageMocks.getConversationById.mockResolvedValue(convo);
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'm1', sequence: 1, contentMarkdown: 'hi', updatedAt: 1 },
    ]);

    const seen: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const url = String(_url || '');
      const method = String(init?.method || 'GET').toUpperCase();
      seen.push({ method, url });

      if (method === 'GET' && url.endsWith('/vault/SyncNos-AIChats/')) {
        return new Response(JSON.stringify({ files: [oldFilename] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes(`/vault/SyncNos-AIChats/${oldFilenameEncoded}`)) {
        return new Response(
          JSON.stringify({
            frontmatter: {
              syncnos: {
                source: 'chatgpt',
                conversationKey: 'k1',
                schemaVersion: 1,
                lastSyncedSequence: 1,
                lastSyncedMessageKey: 'm1',
                lastSyncedMessageUpdatedAt: 1,
              },
            },
            content: 'x',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (method === 'GET') {
        return new Response(JSON.stringify({ errorCode: 40400, message: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (method === 'PUT') {
        order.push('put');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (method === 'DELETE') {
        order.push('delete');
        return new Response(null, { status: 204 });
      }

      return new Response(JSON.stringify({ errorCode: 40000, message: 'unexpected' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    };

    await settingsStore.saveObsidianSettings({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k' });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(syncRes.results[0].ok).toBe(true);
    expect(syncRes.results[0].mode).toBe('full_rebuild_rename');

    const didPut = seen.some((c) => c.method === 'PUT');
    const didDelete = seen.some((c) => c.method === 'DELETE');
    expect(didPut).toBe(true);
    expect(didDelete).toBe(true);
    expect(backgroundStorageMocks.recordObsidianRemoteWrite).toHaveBeenCalledWith({
      source: 'chatgpt',
      conversationKey: 'k1',
    });
    expect(order).toEqual(['put', 'record', 'delete']);
  });
});

afterEach(() => {
  backgroundStorageMocks.getConversationById.mockReset();
  backgroundStorageMocks.getMessagesByConversationId.mockReset();
  backgroundStorageMocks.getArticleCommentsByConversationId.mockReset();
  backgroundStorageMocks.attachOrphanArticleCommentsToConversation.mockReset();
  backgroundStorageMocks.recordObsidianRemoteWrite.mockReset();
  imageCacheMocks.getImageCacheAssetById.mockReset();
  // @ts-expect-error test cleanup
  delete globalThis.fetch;
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});
