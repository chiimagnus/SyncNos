import { describe, expect, it, vi } from 'vitest';

import type { GithubCleanupOutboxRecord } from '@platform/idb/github-cleanup-outbox-record';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';
import { GithubApiError } from '@services/sync/github/github-api-client';
import { commitGithubStagedOperations, GithubGitTransportError } from '@services/sync/github/github-git-transport';
import { buildGithubMarkdownProjection } from '@services/sync/github/github-markdown-projection';
import type { GithubOrchestratorServices } from '@services/sync/github/github-orchestrator-services';
import { createGithubSyncOrchestrator } from '@services/sync/github/github-sync-orchestrator';
import type { SyncJobSnapshot } from '@services/sync/models';

const settings = {
  repository: 'owner/repo',
  branch: 'main',
  defaults: {
    repository: '',
    branch: '',
  },
} as const;

const preflight = {
  repository: 'owner/repo',
  branch: 'main',
  remoteKey: 'github.com/owner/repo@main',
  installationId: 1,
  headSha: 'a'.repeat(40),
  treeSha: 'b'.repeat(40),
};

function chat(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    source: 'chatgpt',
    sourceType: 'chat',
    conversationKey: `key-${id}`,
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    ...overrides,
  };
}

function message(body: string, key = 'm1') {
  return { messageKey: key, sequence: 1, role: 'assistant', contentMarkdown: body };
}

function fakeServices(input: {
  rows: Record<number, { conversation: any; mapping?: any | null }>;
  messages?: Record<number, any[] | Error>;
  comments?: Record<number, any[]>;
  order?: string[];
  commitImpl?: GithubOrchestratorServices['commit'];
  patchFailures?: ReadonlySet<number>;
  loadImage?: GithubOrchestratorServices['loadImage'];
  createBlob?: GithubOrchestratorServices['createBlob'];
  cleanupRows?: GithubCleanupOutboxRecord[];
  cleanupHasMoreDue?: boolean;
  replacementDeferMs?: number;
  now?: number;
  initialJob?: SyncJobSnapshot | null;
  jobSetFailureCalls?: ReadonlySet<number>;
  failJobWritesAfterInitial?: boolean;
}) {
  const defaultCommit: GithubOrchestratorServices['commit'] = async () => ({
    status: 'no_changes',
    treeSha: 'b'.repeat(40),
    files: [],
  });
  const commit = vi.fn(input.commitImpl ?? defaultCommit);
  let cleanupRows = (input.cleanupRows ?? []).map((row) => ({ ...row, paths: [...row.paths] }));
  let persistedJob = input.initialJob ? structuredClone(input.initialJob) : null;
  let jobSetCalls = 0;
  const cloneJob = (job: SyncJobSnapshot | null) => (job ? structuredClone(job) : null);
  const isRunningJob = (job: SyncJobSnapshot | null | undefined, staleMs?: number) => {
    if (!job || job.status !== 'running') return false;
    const updatedAt = Number(job.updatedAt) || 0;
    if (!updatedAt) return true;
    const maxAge = Number.isFinite(Number(staleMs)) ? Math.max(60_000, Number(staleMs)) : 5 * 60 * 1000;
    return Date.now() - updatedAt < maxAge;
  };
  const jobStore: GithubOrchestratorServices['jobStore'] = {
    GITHUB_SYNC_JOB_KEY: 'github_sync_job_v1',
    getJob: vi.fn(async () => cloneJob(persistedJob)),
    setJob: vi.fn(async (job) => {
      jobSetCalls += 1;
      if (input.jobSetFailureCalls?.has(jobSetCalls) || (input.failJobWritesAfterInitial && jobSetCalls > 1))
        return false;
      persistedJob = cloneJob(job);
      return true;
    }),
    isRunningJob: vi.fn(isRunningJob),
    abortRunningJobIfFromOtherInstance: vi.fn(async (instanceId, options) => {
      const current = cloneJob(persistedJob);
      if (!current || current.status !== 'running') return current;
      const owner = String(current.instanceId || '');
      if (!owner || owner === String(instanceId || '')) return current;
      const forceAbort = typeof options === 'object' && options?.forceAbort === true;
      const staleMs = typeof options === 'number' ? options : options?.staleMs;
      if (!forceAbort && isRunningJob(current, staleMs)) return current;
      const now = Date.now();
      persistedJob = {
        ...current,
        status: 'aborted',
        updatedAt: now,
        finishedAt: now,
        abortedReason: 'extension reloaded',
      };
      return cloneJob(persistedJob);
    }),
  };
  const services: GithubOrchestratorServices = {
    getSettings: vi.fn(async () => settings),
    preflight: vi.fn(async () => preflight),
    storage: {
      getSyncMappingByConversation: vi.fn(async (id) => {
        const row = input.rows[id];
        return row ? { conversation: row.conversation, mapping: row.mapping ?? null } : null;
      }),
      getMessagesByConversationId: vi.fn(async (id) => {
        const value = input.messages?.[id] ?? [message(`body-${id}`)];
        if (value instanceof Error) throw value;
        return value;
      }),
      attachOrphanArticleCommentsToConversation: vi.fn(async (_url, id) => {
        input.order?.push(`attach:${id}`);
        return { ok: true };
      }),
      getArticleCommentsByConversationId: vi.fn(async (id) => {
        input.order?.push(`comments:${id}`);
        return input.comments?.[id] ?? [];
      }),
      patchSyncMapping: vi.fn(async (id) => {
        if (input.patchFailures?.has(id)) throw new Error('mapping write failed');
        return true;
      }),
    },
    loadImage: input.loadImage ?? vi.fn(async () => null),
    createBlob: input.createBlob ?? vi.fn(async () => ({ sha: 'c'.repeat(40) })),
    commit,
    listDueCleanupRows: vi.fn(async (remoteKey, now, limit) => {
      const due = cleanupRows
        .filter((row) => row.remoteKey === remoteKey && row.nextAttemptAt <= now)
        .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt || left.createdAt - right.createdAt);
      return {
        rows: due.slice(0, limit),
        hasMoreDue: input.cleanupHasMoreDue ?? due.length > limit,
      };
    }),
    getNextCleanupDueAt: vi.fn(async (remoteKey) => {
      const values = cleanupRows.filter((row) => row.remoteKey === remoteKey).map((row) => row.nextAttemptAt);
      return values.length ? Math.min(...values) : null;
    }),
    deferCleanupRows: vi.fn(async (ids, nextAttemptAt) => {
      const selected = new Set(ids.map(Number));
      cleanupRows = cleanupRows.map((row) => (selected.has(Number(row.id)) ? { ...row, nextAttemptAt } : row));
    }),
    ackCleanupRows: vi.fn(async (ids) => {
      const selected = new Set(ids.map(Number));
      cleanupRows = cleanupRows.filter((row) => !selected.has(Number(row.id)));
    }),
    jobStore,
    replacementDeferMs: input.replacementDeferMs ?? 5_000,
    now: () => input.now ?? 1234,
  };
  return {
    services,
    commit,
    jobStore,
    getPersistedJob: () => cloneJob(persistedJob),
    getCleanupRows: () => cleanupRows.map((row) => ({ ...row, paths: [...row.paths] })),
  };
}

function resolvedFiles(operations: readonly any[], sha = 'e'.repeat(40)) {
  return operations.map((operation) => {
    if (operation.type === 'delete') return { path: operation.path, status: 'deleted' as const };
    return {
      path: operation.path,
      status: operation.type === 'reuse' ? ('reused' as const) : ('written' as const),
      sha: operation.type === 'reuse' ? operation.sha : sha,
    };
  });
}

function cleanupRow(id: number, overrides: Partial<GithubCleanupOutboxRecord> = {}): GithubCleanupOutboxRecord {
  return {
    id,
    remoteKey: preflight.remoteKey,
    paths: [`Old/owned-${id}.md`],
    reason: 'delete',
    createdAt: 1,
    nextAttemptAt: 1,
    ...overrides,
  };
}

function successfulChatGithubMapping(conversation: any, syncedAt = 100) {
  const path = `AIChats/${buildConversationBasename(conversation)}.md`;
  return {
    githubRemoteKey: preflight.remoteKey,
    githubLastSyncedAt: syncedAt,
    githubManagedFiles: {
      [path]: {
        kind: 'markdown' as const,
        contentHash: 'd'.repeat(64),
        sha: 'e'.repeat(40),
      },
    },
  };
}

describe('github sync orchestrator staging through production sync', () => {
  it('dedupes candidate ids and resolves the target exactly once', async () => {
    const { services } = fakeServices({
      rows: { 1: { conversation: chat(1) }, 2: { conversation: chat(2) } },
      commitImpl: async ({ operations }) => ({
        status: 'committed',
        treeSha: 'f'.repeat(40),
        commitSha: '1'.repeat(40),
        files: resolvedFiles(operations),
      }),
    });
    const result = await createGithubSyncOrchestrator(services).sync({
      conversationIds: [1, 1, 2, 0, 'bad'],
      instanceId: 'staging-dedupe',
    });

    expect(services.preflight).toHaveBeenCalledTimes(1);
    expect(services.preflight).toHaveBeenCalledWith({ repository: settings.repository, branch: settings.branch });
    expect(services.getSettings).toHaveBeenCalledTimes(1);
    expect(services.storage.getSyncMappingByConversation).toHaveBeenCalledTimes(2);
    expect(result.summary.candidateCount).toBe(2);
    expect(result.summary.syncedCount).toBe(2);
  });

  it('reattaches article orphans before reading comments by conversation id only', async () => {
    const order: string[] = [];
    let stagedOperations: readonly any[] = [];
    const article = chat(3, {
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-key',
      title: 'Article',
      url: 'https://example.com/article',
    });
    const { services } = fakeServices({
      rows: { 3: { conversation: article } },
      messages: { 3: [message('Article body', 'article_body')] },
      comments: {
        3: [
          {
            id: 30,
            parentId: null,
            conversationId: 3,
            canonicalUrl: article.url,
            quoteText: 'Quote',
            commentText: 'Owned comment',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      order,
      commitImpl: async ({ operations }) => {
        stagedOperations = operations;
        return {
          status: 'committed',
          treeSha: 'f'.repeat(40),
          commitSha: '1'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    });
    const result = await createGithubSyncOrchestrator(services).sync({
      conversationIds: [3],
      instanceId: 'article-stage',
    });

    expect(result.items[0]?.status).toBe('synced');
    expect(order).toEqual(['attach:3', 'comments:3']);
    expect(services.storage.attachOrphanArticleCommentsToConversation).toHaveBeenCalledWith(article.url, 3);
    expect(services.storage.getArticleCommentsByConversationId).toHaveBeenCalledWith(3);
    const write = stagedOperations.find((operation) => operation.type === 'write');
    expect(write?.type === 'write' ? String(write.content) : '').toContain('Owned comment');
  });

  it('isolates one local projection failure and keeps other safe staged rows', async () => {
    let stagedOperations: readonly any[] = [];
    const { services, getPersistedJob } = fakeServices({
      rows: { 1: { conversation: chat(1) }, 2: { conversation: chat(2) } },
      messages: { 1: new Error('broken local read'), 2: [message('safe body')] },
      commitImpl: async ({ operations }) => {
        stagedOperations = operations;
        return {
          status: 'committed',
          treeSha: 'f'.repeat(40),
          commitSha: '1'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    });
    const result = await createGithubSyncOrchestrator(services).sync({
      conversationIds: [1, 2],
      instanceId: 'local-failure',
    });

    expect(result.items.find((item) => item.conversationId === 1)).toMatchObject({
      status: 'failed',
      conversationTitle: 'Title 1',
    });
    expect(result.items.find((item) => item.conversationId === 2)?.status).toBe('synced');
    expect(stagedOperations).toHaveLength(1);
    expect(getPersistedJob()?.perConversation.find((row) => row.conversationId === 1)).toMatchObject({
      conversationTitle: 'Title 1',
      ok: false,
      mode: 'failed',
      error: 'broken local read',
    });
  });

  it('dedupes identical content staged to the same path', async () => {
    const sharedIdentity = {
      source: 'chatgpt',
      conversationKey: 'same-key',
      title: 'Same title',
      url: 'https://example.com/same',
    };
    let stagedOperations: readonly any[] = [];
    const { services } = fakeServices({
      rows: {
        1: { conversation: chat(1, sharedIdentity) },
        2: { conversation: chat(2, sharedIdentity) },
      },
      messages: { 1: [message('same body')], 2: [message('same body')] },
      commitImpl: async ({ operations }) => {
        stagedOperations = operations;
        return {
          status: 'committed',
          treeSha: 'f'.repeat(40),
          commitSha: '1'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    });
    const result = await createGithubSyncOrchestrator(services).sync({
      conversationIds: [1, 2],
      instanceId: 'dedupe-path',
    });

    expect(result.items.map((item) => item.status)).toEqual(['synced', 'synced']);
    expect(stagedOperations).toHaveLength(1);
  });

  it('fails every conversation participating in a conflicting staged path and removes their whole rows', async () => {
    const sharedIdentity = {
      source: 'chatgpt',
      conversationKey: 'same-key',
      title: 'Same title',
      url: 'https://example.com/same',
    };
    const { services, commit } = fakeServices({
      rows: {
        1: { conversation: chat(1, sharedIdentity) },
        2: { conversation: chat(2, sharedIdentity) },
      },
      messages: { 1: [message('first body')], 2: [message('second body')] },
    });
    const result = await createGithubSyncOrchestrator(services).sync({
      conversationIds: [1, 2],
      instanceId: 'collision',
    });

    expect(result.transport.status).toBe('not_needed');
    expect(commit).not.toHaveBeenCalled();
    expect(result.items.map((item) => [item.conversationId, item.status, item.error])).toEqual([
      [1, 'failed', 'github_staged_path_collision'],
      [2, 'failed', 'github_staged_path_collision'],
    ]);
  });

  it('returns all-local-no-op without invoking transport', async () => {
    const conversation = chat(1);
    const messages = [message('same body')];
    const p = await buildGithubMarkdownProjection({ conversation, messages });
    const mapping = {
      githubRemoteKey: preflight.remoteKey,
      githubProjectionFingerprint: p.projectionFingerprint,
      githubManagedFiles: {
        [p.markdownPath]: { kind: 'markdown', contentHash: p.markdownContentHash, sha: 'd'.repeat(40) },
      },
    };
    const { services, commit } = fakeServices({ rows: { 1: { conversation, mapping } }, messages: { 1: messages } });
    const result = await createGithubSyncOrchestrator(services).sync({
      conversationIds: [1],
      instanceId: 'local-no-op',
    });

    expect(result.transport.status).toBe('not_needed');
    expect(result.items[0]?.status).toBe('no_changes');
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('github sync orchestrator job lifecycle', () => {
  it('rejects a concurrent run before a second caller can enter the persisted job claim', async () => {
    const { services, jobStore } = fakeServices({
      rows: { 1: { conversation: chat(1) }, 2: { conversation: chat(2) } },
    });
    let releaseFirstClaimRead!: (value: SyncJobSnapshot | null) => void;
    const firstClaimRead = new Promise<SyncJobSnapshot | null>((resolve) => {
      releaseFirstClaimRead = resolve;
    });
    (jobStore.abortRunningJobIfFromOtherInstance as any)
      .mockImplementationOnce(async () => await firstClaimRead)
      .mockResolvedValue(null);

    const orchestrator = createGithubSyncOrchestrator(services);
    const firstRun = orchestrator.sync({ conversationIds: [1], instanceId: 'instance-a' });
    await vi.waitFor(() => expect(jobStore.abortRunningJobIfFromOtherInstance).toHaveBeenCalledTimes(1));

    const secondRun = orchestrator.sync({ conversationIds: [2], instanceId: 'instance-a' });
    await Promise.resolve();
    const claimReadsWhileFirstBlocked = (jobStore.abortRunningJobIfFromOtherInstance as any).mock.calls.length;

    releaseFirstClaimRead(null);
    const [firstResult, secondResult] = await Promise.allSettled([firstRun, secondRun]);

    expect(claimReadsWhileFirstBlocked).toBe(1);
    expect(firstResult.status).toBe('fulfilled');
    expect(secondResult.status).toBe('rejected');
    if (secondResult.status === 'rejected') {
      expect(secondResult.reason).toMatchObject({ code: 'sync_already_running' });
    }
  });

  it('publishes per-item GitHub staging progress with the current conversation title', async () => {
    const { services, jobStore } = fakeServices({
      rows: { 1: { conversation: chat(1) }, 2: { conversation: chat(2) } },
      commitImpl: async ({ operations }) => ({
        status: 'committed',
        treeSha: 'f'.repeat(40),
        commitSha: '1'.repeat(40),
        files: resolvedFiles(operations),
      }),
    });

    await createGithubSyncOrchestrator(services).sync({
      conversationIds: [1, 2],
      instanceId: 'progress-title',
    });

    const snapshots = (jobStore.setJob as any).mock.calls.map((call: any[]) => call[0] as SyncJobSnapshot);
    expect(snapshots).toContainEqual(
      expect.objectContaining({
        status: 'running',
        currentConversationId: 1,
        currentConversationTitle: 'Title 1',
        currentStage: 'staging_projection',
      }),
    );
    expect(snapshots).toContainEqual(
      expect.objectContaining({
        status: 'running',
        currentConversationId: 2,
        currentConversationTitle: 'Title 2',
        currentStage: 'staging_projection',
        perConversation: [
          expect.objectContaining({ conversationId: 1, conversationTitle: 'Title 1', ok: true, mode: 'staged' }),
        ],
      }),
    );
    expect(snapshots).toContainEqual(
      expect.objectContaining({
        status: 'running',
        currentConversationId: 2,
        currentConversationTitle: 'Title 2',
        currentStage: 'finishing_current_item',
        okCount: 2,
        failCount: 0,
        perConversation: [
          expect.objectContaining({ conversationId: 1, conversationTitle: 'Title 1', mode: 'staged' }),
          expect.objectContaining({ conversationId: 2, conversationTitle: 'Title 2', mode: 'staged' }),
        ],
      }),
    );
  });

  it('claims the generic job before preflight and persists the terminal conversation result', async () => {
    const { services, commit, jobStore, getPersistedJob } = fakeServices({
      rows: { 1: { conversation: chat(1) } },
      commitImpl: async ({ operations }) => ({
        status: 'committed',
        treeSha: 'f'.repeat(40),
        commitSha: '1'.repeat(40),
        files: resolvedFiles(operations),
      }),
    });

    const result = await createGithubSyncOrchestrator(services).sync({
      conversationIds: [1],
      instanceId: 'instance-a',
    });

    expect(result.items[0]?.status).toBe('synced');
    expect(jobStore.setJob).toHaveBeenCalled();
    expect((jobStore.setJob as any).mock.calls[0]?.[0]).toMatchObject({
      provider: 'github',
      instanceId: 'instance-a',
      status: 'running',
      conversationIds: [1],
      currentStage: 'preparing_queue',
    });
    expect((jobStore.setJob as any).mock.invocationCallOrder[0]).toBeLessThan(
      (services.preflight as any).mock.invocationCallOrder[0],
    );
    expect((jobStore.setJob as any).mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]);
    expect(getPersistedJob()).toMatchObject({
      provider: 'github',
      instanceId: 'instance-a',
      status: 'done',
      currentStage: 'done',
      okCount: 1,
      failCount: 0,
      perConversation: [{ conversationId: 1, ok: true, mode: 'synced', appended: 0, error: '' }],
    });
  });

  it('does not create a cleanup-only job when no matching outbox work is due', async () => {
    const { services, jobStore } = fakeServices({ rows: {}, cleanupRows: [] });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [], instanceId: 'instance-a' });

    expect(result.transport.status).toBe('not_needed');
    expect(jobStore.setJob).not.toHaveBeenCalled();
  });

  it('claims cleanup-only work before the branch mutation and finishes with zero conversation rows', async () => {
    const { services, commit, jobStore, getPersistedJob } = fakeServices({
      rows: {},
      cleanupRows: [cleanupRow(40)],
      commitImpl: async ({ operations }) => ({
        status: 'committed',
        treeSha: 'f'.repeat(40),
        commitSha: '1'.repeat(40),
        files: resolvedFiles(operations),
      }),
    });

    await createGithubSyncOrchestrator(services).sync({ conversationIds: [], instanceId: 'instance-a' });

    expect((jobStore.setJob as any).mock.calls[0]?.[0]).toMatchObject({
      status: 'running',
      conversationIds: [],
      currentStage: 'cleaning_remote_files',
    });
    expect((jobStore.setJob as any).mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]);
    expect(getPersistedJob()).toMatchObject({
      status: 'done',
      conversationIds: [],
      okCount: 0,
      failCount: 0,
      perConversation: [],
    });
  });

  it('rejects an active same-instance job before preflight or remote mutation', async () => {
    const activeJob: SyncJobSnapshot = {
      id: 'active',
      provider: 'github',
      instanceId: 'instance-a',
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      conversationIds: [1],
      okCount: 0,
      failCount: 0,
      perConversation: [],
    };
    const { services, commit } = fakeServices({ rows: { 1: { conversation: chat(1) } }, initialJob: activeJob });

    await expect(
      createGithubSyncOrchestrator(services).sync({ conversationIds: [1], instanceId: 'instance-a' }),
    ).rejects.toMatchObject({ code: 'sync_already_running' });
    expect(services.preflight).not.toHaveBeenCalled();
    expect(services.createBlob).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('reconciles a stale foreign job before claiming the new run', async () => {
    const staleJob: SyncJobSnapshot = {
      id: 'foreign',
      provider: 'github',
      instanceId: 'old-instance',
      status: 'running',
      startedAt: Date.now() - 700_000,
      updatedAt: Date.now() - 700_000,
      finishedAt: null,
      conversationIds: [9],
      okCount: 0,
      failCount: 0,
      perConversation: [],
    };
    const { services, jobStore, getPersistedJob } = fakeServices({
      rows: { 1: { conversation: chat(1) } },
      initialJob: staleJob,
      commitImpl: async ({ operations }) => ({
        status: 'committed',
        treeSha: 'f'.repeat(40),
        commitSha: '1'.repeat(40),
        files: resolvedFiles(operations),
      }),
    });

    await createGithubSyncOrchestrator(services).sync({ conversationIds: [1], instanceId: 'new-instance' });

    expect(jobStore.abortRunningJobIfFromOtherInstance).toHaveBeenCalledWith('new-instance');
    expect(getPersistedJob()).toMatchObject({ status: 'done', instanceId: 'new-instance', conversationIds: [1] });
  });

  it('fails closed when the initial running snapshot cannot be persisted', async () => {
    const { services, commit } = fakeServices({
      rows: { 1: { conversation: chat(1) } },
      jobSetFailureCalls: new Set([1]),
    });

    await expect(
      createGithubSyncOrchestrator(services).sync({ conversationIds: [1], instanceId: 'instance-a' }),
    ).rejects.toMatchObject({ code: 'github_sync_job_persist_failed' });
    expect(services.getSettings).not.toHaveBeenCalled();
    expect(services.preflight).not.toHaveBeenCalled();
    expect(services.createBlob).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('keeps the remote result when progress and terminal job persistence fail after the initial claim', async () => {
    const { services, commit, getPersistedJob } = fakeServices({
      rows: { 1: { conversation: chat(1) } },
      failJobWritesAfterInitial: true,
      commitImpl: async ({ operations }) => ({
        status: 'committed',
        treeSha: 'f'.repeat(40),
        commitSha: '1'.repeat(40),
        files: resolvedFiles(operations),
      }),
    });

    const result = await createGithubSyncOrchestrator(services).sync({
      conversationIds: [1],
      instanceId: 'instance-a',
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(services.storage.patchSyncMapping).toHaveBeenCalledTimes(1);
    expect(result.transport.status).toBe('committed');
    expect(result.items[0]?.status).toBe('synced');
    expect(result.cleanupWarnings).toContain('github_sync_job_persist_failed');
    expect(getPersistedJob()).toMatchObject({ status: 'running', currentStage: 'preparing_queue' });
  });

  it('persists a safe terminal failure when preflight fails after the job claim', async () => {
    const { services, commit, getPersistedJob } = fakeServices({ rows: { 1: { conversation: chat(1) } } });
    services.preflight = vi.fn(async () => {
      throw Object.assign(new Error('auth required'), { code: 'github_auth_required' });
    });

    await expect(
      createGithubSyncOrchestrator(services).sync({ conversationIds: [1], instanceId: 'instance-a' }),
    ).rejects.toMatchObject({ code: 'github_auth_required' });
    expect(commit).not.toHaveBeenCalled();
    expect(getPersistedJob()).toMatchObject({
      status: 'done',
      failCount: 1,
      perConversation: [{ conversationId: 1, ok: false, error: 'github_auth_required' }],
    });
  });
});

describe('github sync orchestrator cleanup outbox', () => {
  it('runs unconditional cleanup without conversation candidates and acks only after one successful transport', async () => {
    let committedOperations: readonly any[] = [];
    const { services, commit, getCleanupRows } = fakeServices({
      rows: {},
      cleanupRows: [cleanupRow(1)],
      commitImpl: async ({ operations }) => {
        committedOperations = operations;
        return {
          status: 'committed',
          treeSha: 'f'.repeat(40),
          commitSha: '1'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(committedOperations).toEqual([{ type: 'delete', path: 'Old/owned-1.md' }]);
    expect(services.ackCleanupRows).toHaveBeenCalledWith([1]);
    expect(getCleanupRows()).toEqual([]);
    expect(result.transport.status).toBe('committed');
    expect(result.cleanupHasMoreDue).toBe(false);
    expect(result.nextCleanupDueAt).toBeNull();
    expect(result.deferredReplacementConversationIds).toEqual([]);
  });

  it('merges cleanup into the conversation branch transaction and lets current writes override stale deletes', async () => {
    const current = chat(1);
    const messages = [message('current body')];
    const projection = await buildGithubMarkdownProjection({ conversation: current, messages, folders: settings });
    let committedOperations: readonly any[] = [];
    const { services, commit } = fakeServices({
      rows: { 1: { conversation: current } },
      messages: { 1: messages },
      cleanupRows: [
        cleanupRow(1, {
          paths: [projection.markdownPath, 'Old/stale.md'],
        }),
      ],
      commitImpl: async ({ operations }) => {
        committedOperations = operations;
        return {
          status: 'committed',
          treeSha: 'f'.repeat(40),
          commitSha: '1'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [1] });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(committedOperations.filter((operation) => operation.path === projection.markdownPath)).toHaveLength(1);
    expect(committedOperations.find((operation) => operation.path === projection.markdownPath)?.type).toBe('write');
    expect(committedOperations).toContainEqual({ type: 'delete', path: 'Old/stale.md' });
    expect(result.items[0]?.status).toBe('synced');
    expect(services.ackCleanupRows).toHaveBeenCalledWith([1]);
  });

  it('keeps the replacement current write when an identity-move row names the same path and acks only after transport', async () => {
    const replacement = chat(19);
    const messages = [message('replacement body')];
    const projection = await buildGithubMarkdownProjection({ conversation: replacement, messages });
    let committedOperations: readonly any[] = [];
    let markCommitStarted!: () => void;
    let releaseCommit!: () => void;
    const commitStarted = new Promise<void>((resolve) => {
      markCommitStarted = resolve;
    });
    const commitRelease = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const { services, commit, getCleanupRows } = fakeServices({
      rows: { 19: { conversation: replacement, mapping: null } },
      messages: { 19: messages },
      cleanupRows: [
        cleanupRow(19, {
          paths: [projection.markdownPath],
          reason: 'identity_move',
          replacementConversationId: 19,
        }),
      ],
      commitImpl: async ({ operations }) => {
        committedOperations = operations;
        markCommitStarted();
        await commitRelease;
        return {
          status: 'committed',
          treeSha: 'f'.repeat(40),
          commitSha: '1'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    });

    const run = createGithubSyncOrchestrator(services).sync({ conversationIds: [19] });
    await commitStarted;

    expect(commit).toHaveBeenCalledTimes(1);
    expect(committedOperations.filter((operation) => operation.path === projection.markdownPath)).toHaveLength(1);
    expect(committedOperations.find((operation) => operation.path === projection.markdownPath)?.type).toBe('write');
    expect(committedOperations.some((operation) => operation.type === 'delete')).toBe(false);
    expect(services.ackCleanupRows).not.toHaveBeenCalled();
    expect(getCleanupRows()).toHaveLength(1);

    releaseCommit();
    const result = await run;

    expect(result.items[0]).toMatchObject({ conversationId: 19, status: 'synced' });
    expect(services.ackCleanupRows).toHaveBeenCalledWith([19]);
    expect(getCleanupRows()).toEqual([]);
  });

  it('defers identity cleanup while the replacement exists without same-target success', async () => {
    const { services, commit, getCleanupRows } = fakeServices({
      rows: { 2: { conversation: chat(2), mapping: null } },
      cleanupRows: [
        cleanupRow(7, {
          reason: 'identity_move',
          replacementConversationId: 2,
        }),
      ],
      now: 2_000,
      replacementDeferMs: 7_000,
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });

    expect(commit).not.toHaveBeenCalled();
    expect(services.deferCleanupRows).toHaveBeenCalledWith([7], 9_000);
    expect(services.ackCleanupRows).not.toHaveBeenCalled();
    expect(getCleanupRows()[0]?.nextAttemptAt).toBe(9_000);
    expect(result.transport.status).toBe('not_needed');
    expect(result.deferredReplacementConversationIds).toEqual([2]);
    expect(result.nextCleanupDueAt).toBe(9_000);
  });

  it('rejects malformed same-target success timestamps before identity cleanup', async () => {
    const { services, commit, getCleanupRows } = fakeServices({
      rows: {
        7: {
          conversation: chat(7),
          mapping: successfulChatGithubMapping(chat(7), -1),
        },
      },
      cleanupRows: [cleanupRow(15, { reason: 'identity_move', replacementConversationId: 7 })],
      now: 5_000,
      replacementDeferMs: 1_000,
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });

    expect(commit).not.toHaveBeenCalled();
    expect(services.deferCleanupRows).toHaveBeenCalledWith([15], 6_000);
    expect(services.ackCleanupRows).not.toHaveBeenCalled();
    expect(getCleanupRows()[0]?.nextAttemptAt).toBe(6_000);
    expect(result.deferredReplacementConversationIds).toEqual([7]);
  });

  it('defers identity cleanup when same-target replacement continuity has no owned managed files', async () => {
    const replacement = chat(16);
    const { services, commit, getCleanupRows } = fakeServices({
      rows: {
        16: {
          conversation: replacement,
          mapping: { githubRemoteKey: preflight.remoteKey, githubLastSyncedAt: 100, githubManagedFiles: {} },
        },
      },
      cleanupRows: [cleanupRow(16, { reason: 'identity_move', replacementConversationId: 16 })],
      now: 6_000,
      replacementDeferMs: 1_000,
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });

    expect(commit).not.toHaveBeenCalled();
    expect(services.deferCleanupRows).toHaveBeenCalledWith([16], 7_000);
    expect(services.ackCleanupRows).not.toHaveBeenCalled();
    expect(getCleanupRows()[0]?.nextAttemptAt).toBe(7_000);
    expect(result.deferredReplacementConversationIds).toEqual([16]);
  });

  it('defers identity cleanup when same-target replacement continuity contains only an owned asset', async () => {
    const replacement = chat(17);
    const basename = buildConversationBasename(replacement);
    const { services, commit, getCleanupRows } = fakeServices({
      rows: {
        17: {
          conversation: replacement,
          mapping: {
            githubRemoteKey: preflight.remoteKey,
            githubLastSyncedAt: 100,
            githubManagedFiles: {
              [`AIChats/${basename}.assets/${'a'.repeat(64)}.png`]: {
                kind: 'asset',
                contentHash: 'd'.repeat(64),
                sha: 'e'.repeat(40),
              },
            },
          },
        },
      },
      cleanupRows: [cleanupRow(17, { reason: 'identity_move', replacementConversationId: 17 })],
      now: 7_000,
      replacementDeferMs: 1_000,
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });

    expect(commit).not.toHaveBeenCalled();
    expect(services.deferCleanupRows).toHaveBeenCalledWith([17], 8_000);
    expect(services.ackCleanupRows).not.toHaveBeenCalled();
    expect(getCleanupRows()[0]?.nextAttemptAt).toBe(8_000);
    expect(result.deferredReplacementConversationIds).toEqual([17]);
  });

  it('defers identity cleanup when same-target replacement continuity contains only unowned managed files', async () => {
    const replacement = chat(18);
    const basename = buildConversationBasename(replacement);
    const { services, commit, getCleanupRows } = fakeServices({
      rows: {
        18: {
          conversation: replacement,
          mapping: {
            githubRemoteKey: preflight.remoteKey,
            githubLastSyncedAt: 100,
            githubManagedFiles: {
              [`OtherFolder/${basename}.md`]: {
                kind: 'markdown',
                contentHash: 'd'.repeat(64),
                sha: 'e'.repeat(40),
              },
            },
          },
        },
      },
      cleanupRows: [cleanupRow(18, { reason: 'identity_move', replacementConversationId: 18 })],
      now: 8_000,
      replacementDeferMs: 1_000,
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });

    expect(commit).not.toHaveBeenCalled();
    expect(services.deferCleanupRows).toHaveBeenCalledWith([18], 9_000);
    expect(services.ackCleanupRows).not.toHaveBeenCalled();
    expect(getCleanupRows()[0]?.nextAttemptAt).toBe(9_000);
    expect(result.deferredReplacementConversationIds).toEqual([18]);
  });

  it('allows identity cleanup after same-target replacement success or local replacement deletion', async () => {
    let committedOperations: readonly any[] = [];
    const replacement = chat(2);
    const { services, getCleanupRows } = fakeServices({
      rows: {
        2: {
          conversation: replacement,
          mapping: successfulChatGithubMapping(replacement),
        },
      },
      cleanupRows: [
        cleanupRow(8, { reason: 'identity_move', replacementConversationId: 2 }),
        cleanupRow(9, { reason: 'identity_move', replacementConversationId: 3 }),
      ],
      commitImpl: async ({ operations }) => {
        committedOperations = operations;
        return {
          status: 'no_changes',
          treeSha: 'f'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });

    expect(committedOperations).toEqual([
      { type: 'delete', path: 'Old/owned-8.md' },
      { type: 'delete', path: 'Old/owned-9.md' },
    ]);
    expect(services.ackCleanupRows).toHaveBeenCalledWith([8, 9]);
    expect(getCleanupRows()).toEqual([]);
    expect(result.transport.status).toBe('no_changes');
  });

  it('keeps eligible cleanup pending when the shared transport fails', async () => {
    const { services, getCleanupRows } = fakeServices({
      rows: {},
      cleanupRows: [cleanupRow(10)],
      commitImpl: async () => {
        throw Object.assign(new Error('offline'), { code: 'github_network_error' });
      },
      now: 4_000,
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });

    expect(result.transport.status).toBe('failed');
    expect(services.ackCleanupRows).not.toHaveBeenCalled();
    expect(getCleanupRows()).toHaveLength(1);
    expect(result.nextCleanupDueAt).toBe(1);
  });

  it('returns bounded cleanup scheduling metadata without treating deferred rows as more due work', async () => {
    const { services } = fakeServices({
      rows: { 5: { conversation: chat(5), mapping: null } },
      cleanupRows: [cleanupRow(11, { reason: 'identity_move', replacementConversationId: 5 })],
      cleanupHasMoreDue: false,
      now: 10_000,
      replacementDeferMs: 2_000,
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });
    expect(result.cleanupHasMoreDue).toBe(false);
    expect(result.nextCleanupDueAt).toBe(12_000);
    expect(result.deferredReplacementConversationIds).toEqual([5]);
  });

  it('re-drains the same cleanup after remote success is followed by a lost local acknowledgement', async () => {
    let remotePresent = true;
    let failAck = true;
    const { services, commit, getCleanupRows } = fakeServices({
      rows: {},
      cleanupRows: [cleanupRow(12)],
      commitImpl: async ({ operations }) => {
        if (remotePresent) {
          remotePresent = false;
          return {
            status: 'committed',
            treeSha: 'f'.repeat(40),
            commitSha: '1'.repeat(40),
            files: resolvedFiles(operations),
          };
        }
        return {
          status: 'no_changes',
          treeSha: 'f'.repeat(40),
          files: operations.map((operation) =>
            operation.type === 'delete'
              ? { path: operation.path, status: 'absent' as const }
              : { path: operation.path, status: 'written' as const, sha: 'e'.repeat(40) },
          ),
        };
      },
    });
    const durableAck = services.ackCleanupRows;
    services.ackCleanupRows = vi.fn(async (ids) => {
      if (failAck) throw new Error('local ack failed');
      return await durableAck(ids);
    });
    const orchestrator = createGithubSyncOrchestrator(services);

    const first = await orchestrator.sync({ conversationIds: [] });

    expect(first.transport).toEqual({ status: 'committed', commitSha: '1'.repeat(40) });
    expect(first.cleanupWarnings).toContain('github_cleanup_ack_failed');
    expect(getCleanupRows()).toHaveLength(1);
    expect(first.nextCleanupDueAt).toBe(1);

    failAck = false;
    const second = await orchestrator.sync({ conversationIds: [] });

    expect(commit).toHaveBeenCalledTimes(2);
    expect(second.transport.status).toBe('no_changes');
    expect(services.ackCleanupRows).toHaveBeenLastCalledWith([12]);
    expect(getCleanupRows()).toEqual([]);
  });

  it('keeps deferred cleanup locally retryable when the defer write fails', async () => {
    const { services, commit, getCleanupRows } = fakeServices({
      rows: { 6: { conversation: chat(6), mapping: null } },
      cleanupRows: [cleanupRow(13, { reason: 'identity_move', replacementConversationId: 6 })],
      now: 20_000,
      replacementDeferMs: 3_000,
    });
    services.deferCleanupRows = vi.fn(async () => {
      throw new Error('local defer failed');
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });

    expect(commit).not.toHaveBeenCalled();
    expect(services.ackCleanupRows).not.toHaveBeenCalled();
    expect(result.cleanupWarnings).toContain('github_cleanup_defer_failed');
    expect(result.deferredReplacementConversationIds).toEqual([6]);
    expect(getCleanupRows()[0]?.nextAttemptAt).toBe(1);
    expect(result.nextCleanupDueAt).toBe(1);
  });

  it('leaves cleanup for another remote target untouched', async () => {
    const { services, commit, getCleanupRows } = fakeServices({
      rows: {},
      cleanupRows: [cleanupRow(14, { remoteKey: 'github.com/owner/other@main' })],
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });

    expect(commit).not.toHaveBeenCalled();
    expect(services.ackCleanupRows).not.toHaveBeenCalled();
    expect(services.deferCleanupRows).not.toHaveBeenCalled();
    expect(getCleanupRows()).toHaveLength(1);
    expect(result.nextCleanupDueAt).toBeNull();
  });
});

describe('github sync orchestrator cleanup crash recovery', () => {
  it('does not ack an outcome-unknown cleanup and acks it on the next absent no-op retry', async () => {
    let remotePresent = true;
    let attempts = 0;
    const { services, getCleanupRows } = fakeServices({
      rows: {},
      cleanupRows: [cleanupRow(20)],
      commitImpl: async ({ operations }) => {
        attempts += 1;
        if (attempts === 1) {
          remotePresent = false;
          throw new GithubApiError('github_outcome_unknown', 0, 'github_outcome_unknown');
        }
        expect(remotePresent).toBe(false);
        return {
          status: 'no_changes',
          treeSha: 'f'.repeat(40),
          files: operations.map((operation) =>
            operation.type === 'delete'
              ? { path: operation.path, status: 'absent' as const }
              : { path: operation.path, status: 'written' as const, sha: 'e'.repeat(40) },
          ),
        };
      },
    });
    const orchestrator = createGithubSyncOrchestrator(services);

    const first = await orchestrator.sync({ conversationIds: [] });
    expect(first.transport.status).toBe('failed');
    expect(services.ackCleanupRows).not.toHaveBeenCalled();
    expect(getCleanupRows()).toHaveLength(1);

    const second = await orchestrator.sync({ conversationIds: [] });
    expect(second.transport.status).toBe('no_changes');
    expect(getCleanupRows()).toEqual([]);
    expect(services.ackCleanupRows).toHaveBeenCalledWith([20]);
  });

  it('keeps cleanup pending across exhausted ref races and acks only after a later successful run', async () => {
    let failRace = true;
    const { services, getCleanupRows } = fakeServices({
      rows: {},
      cleanupRows: [cleanupRow(21)],
      commitImpl: async ({ operations }) => {
        if (failRace) throw new GithubGitTransportError('github_git_branch_race_exhausted');
        return {
          status: 'committed',
          treeSha: 'f'.repeat(40),
          commitSha: '1'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    });
    const orchestrator = createGithubSyncOrchestrator(services);

    const first = await orchestrator.sync({ conversationIds: [] });
    expect(first.transport.status).toBe('failed');
    expect(getCleanupRows()).toHaveLength(1);

    failRace = false;
    const second = await orchestrator.sync({ conversationIds: [] });
    expect(second.transport.status).toBe('committed');
    expect(getCleanupRows()).toEqual([]);
  });

  it('defers identity cleanup when the replacement is in the current run but local projection fails', async () => {
    const { services, commit, getCleanupRows } = fakeServices({
      rows: { 22: { conversation: chat(22), mapping: null } },
      messages: { 22: new Error('projection failed') },
      cleanupRows: [cleanupRow(22, { reason: 'identity_move', replacementConversationId: 22 })],
      now: 30_000,
      replacementDeferMs: 4_000,
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [22] });

    expect(result.items[0]).toMatchObject({ conversationId: 22, status: 'failed' });
    expect(commit).not.toHaveBeenCalled();
    expect(services.deferCleanupRows).toHaveBeenCalledWith([22], 34_000);
    expect(services.ackCleanupRows).not.toHaveBeenCalled();
    expect(getCleanupRows()[0]?.nextAttemptAt).toBe(34_000);
    expect(result.deferredReplacementConversationIds).toEqual([22]);
  });

  it('pages cleanup without starvation after a full page of identity rows is deferred', async () => {
    const replacementIds = Array.from({ length: 100 }, (_, index) => 1_000 + index);
    const rows = replacementIds.map((replacementConversationId, index) =>
      cleanupRow(index + 1, {
        reason: 'identity_move',
        replacementConversationId,
        createdAt: 1,
        nextAttemptAt: 1,
      }),
    );
    rows.push(cleanupRow(101, { paths: ['Old/after-deferred-page.md'], createdAt: 2, nextAttemptAt: 2 }));
    const replacementRows = Object.fromEntries(
      replacementIds.map((id) => [id, { conversation: chat(id), mapping: null }]),
    );
    let committedOperations: readonly any[] = [];
    const { services, commit, getCleanupRows } = fakeServices({
      rows: replacementRows,
      cleanupRows: rows,
      now: 10,
      replacementDeferMs: 1_000,
      commitImpl: async ({ operations }) => {
        committedOperations = operations;
        return {
          status: 'no_changes',
          treeSha: 'f'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    });
    const orchestrator = createGithubSyncOrchestrator(services);

    const first = await orchestrator.sync({ conversationIds: [] });
    expect(first.cleanupHasMoreDue).toBe(true);
    expect(first.deferredReplacementConversationIds).toHaveLength(100);
    expect(commit).not.toHaveBeenCalled();
    expect(getCleanupRows().filter((row) => row.nextAttemptAt === 1_010)).toHaveLength(100);

    const second = await orchestrator.sync({ conversationIds: [] });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(committedOperations).toEqual([{ type: 'delete', path: 'Old/after-deferred-page.md' }]);
    expect(getCleanupRows()).toHaveLength(100);
    expect(second.cleanupHasMoreDue).toBe(false);
    expect(second.nextCleanupDueAt).toBe(1_010);
  });
});

describe('github sync orchestrator transport acknowledgement', () => {
  it('commits two changed rows once and patches continuity only after the transport resolves', async () => {
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let resolveCommit!: (value: any) => void;
    const pending = new Promise<any>((resolve) => {
      resolveCommit = resolve;
    });
    let captured: any = null;
    const { services, commit } = fakeServices({
      rows: { 1: { conversation: chat(1) }, 2: { conversation: chat(2) } },
      now: 555,
      commitImpl: async (input) => {
        captured = input;
        resolveStarted();
        return pending;
      },
    });
    const orchestrator = createGithubSyncOrchestrator(services);
    const syncPromise = orchestrator.sync({ conversationIds: [1, 2] });

    await started;
    expect(commit).toHaveBeenCalledTimes(1);
    expect(services.storage.patchSyncMapping).not.toHaveBeenCalled();
    expect(captured.message).toBe('SyncNos GitHub sync (2 items)');
    expect(captured.message).not.toMatch(/Title|body-/);

    resolveCommit({
      status: 'committed',
      treeSha: 'f'.repeat(40),
      commitSha: '1'.repeat(40),
      files: resolvedFiles(captured.operations),
    });
    const result = await syncPromise;

    expect(result.transport).toEqual({ status: 'committed', commitSha: '1'.repeat(40) });
    expect(result.items.map((item) => item.status)).toEqual(['synced', 'synced']);
    expect(services.storage.patchSyncMapping).toHaveBeenCalledTimes(2);
    for (const [, patch] of (services.storage.patchSyncMapping as any).mock.calls) {
      expect(patch.githubRemoteKey).toBe(preflight.remoteKey);
      expect(patch.githubProjectionFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(patch.githubLastSyncedAt).toBe(555);
      expect(Object.values(patch.githubManagedFiles)).toEqual([
        expect.objectContaining({ kind: 'markdown', sha: 'e'.repeat(40) }),
      ]);
    }
  });

  it('repairs staged continuity when transport proves the desired tree is already current', async () => {
    const current = chat(1);
    const messages = [message('new body')];
    const projected = await buildGithubMarkdownProjection({ conversation: current, messages, folders: settings });
    const mapping = {
      githubRemoteKey: preflight.remoteKey,
      githubProjectionFingerprint: '0'.repeat(64),
      githubManagedFiles: {
        [projected.markdownPath]: { kind: 'markdown', contentHash: '1'.repeat(64), sha: 'd'.repeat(40) },
      },
    };
    const { services } = fakeServices({
      rows: { 1: { conversation: current, mapping } },
      messages: { 1: messages },
      commitImpl: async ({ operations }) => ({
        status: 'no_changes',
        treeSha: 'f'.repeat(40),
        files: resolvedFiles(operations, '9'.repeat(40)),
      }),
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [1] });
    expect(result.transport.status).toBe('no_changes');
    expect(result.items[0]?.status).toBe('synced');
    expect(services.storage.patchSyncMapping).toHaveBeenCalledTimes(1);
    const patch = (services.storage.patchSyncMapping as any).mock.calls[0][1];
    expect(patch.githubManagedFiles[projected.markdownPath]).toEqual({
      kind: 'markdown',
      contentHash: projected.markdownContentHash,
      sha: '9'.repeat(40),
    });
  });

  it('keeps mappings untouched on outcome-unknown while preserving local no-op success', async () => {
    const noOpConversation = chat(2);
    const noOpMessages = [message('same body')];
    const noOpProjection = await buildGithubMarkdownProjection({
      conversation: noOpConversation,
      messages: noOpMessages,
      folders: settings,
    });
    const noOpMapping = {
      githubRemoteKey: preflight.remoteKey,
      githubProjectionFingerprint: noOpProjection.projectionFingerprint,
      githubManagedFiles: {
        [noOpProjection.markdownPath]: {
          kind: 'markdown',
          contentHash: noOpProjection.markdownContentHash,
          sha: 'd'.repeat(40),
        },
      },
    };
    const { services } = fakeServices({
      rows: {
        1: { conversation: chat(1) },
        2: { conversation: noOpConversation, mapping: noOpMapping },
      },
      messages: { 2: noOpMessages },
      commitImpl: async () => {
        throw Object.assign(new Error('ambiguous'), { code: 'github_outcome_unknown' });
      },
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [1, 2] });
    expect(services.storage.patchSyncMapping).not.toHaveBeenCalled();
    expect(result.transport.status).toBe('failed');
    expect(result.items.map((item) => [item.conversationId, item.status, item.error])).toEqual([
      [1, 'failed', 'github_outcome_unknown'],
      [2, 'no_changes', ''],
    ]);
  });

  it('keeps a successful remote commit while isolating a single mapping patch failure', async () => {
    const { services } = fakeServices({
      rows: { 1: { conversation: chat(1) }, 2: { conversation: chat(2) } },
      patchFailures: new Set([2]),
      commitImpl: async ({ operations }) => ({
        status: 'committed',
        treeSha: 'f'.repeat(40),
        commitSha: '1'.repeat(40),
        files: resolvedFiles(operations),
      }),
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [1, 2] });
    expect(result.transport).toEqual({ status: 'committed', commitSha: '1'.repeat(40) });
    expect(result.items.map((item) => item.status)).toEqual(['synced', 'mapping_failed']);
    expect(result.items[1]?.warnings).toContain('github_mapping_patch_failed');
    expect(services.storage.patchSyncMapping).toHaveBeenCalledTimes(2);
  });

  it('does not ack any staged row when transport file resolution is incomplete', async () => {
    const { services } = fakeServices({
      rows: { 1: { conversation: chat(1) } },
      commitImpl: async () => ({
        status: 'committed',
        treeSha: 'f'.repeat(40),
        commitSha: '1'.repeat(40),
        files: [],
      }),
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [1] });
    expect(result.transport.status).toBe('invalid_resolution');
    expect(result.items[0]).toMatchObject({ status: 'failed', error: 'github_transport_resolution_incomplete' });
    expect(services.storage.patchSyncMapping).not.toHaveBeenCalled();
  });
});

describe('github sync orchestrator atomic cross-layer contracts', () => {
  function actualTransport(treeNoOp = false) {
    const HEAD = '3'.repeat(40);
    const BASE = '4'.repeat(40);
    const NEXT = '5'.repeat(40);
    const COMMIT = '6'.repeat(40);
    let blobIndex = 0;
    const calls: Array<{ method: string; path: string; body?: any }> = [];
    const api = {
      async get<T>(path: string): Promise<T> {
        calls.push({ method: 'GET', path });
        if (path.endsWith('/git/ref/heads/main')) return { object: { type: 'commit', sha: HEAD } } as T;
        if (path.endsWith(`/git/commits/${HEAD}`)) return { tree: { sha: BASE } } as T;
        throw new Error(`unexpected:${path}`);
      },
      async post<T>(path: string, body?: unknown): Promise<T> {
        calls.push({ method: 'POST', path, body });
        if (path.endsWith('/git/blobs')) {
          blobIndex += 1;
          return {
            sha: Math.min(15, 6 + blobIndex)
              .toString(16)
              .repeat(40),
          } as T;
        }
        if (path.endsWith('/git/trees')) return { sha: treeNoOp ? BASE : NEXT } as T;
        if (path.endsWith('/git/commits')) return { sha: COMMIT } as T;
        throw new Error(`unexpected:${path}`);
      },
      async patch<T>(path: string, body?: unknown): Promise<T> {
        calls.push({ method: 'PATCH', path, body });
        return { object: { sha: COMMIT } } as T;
      },
    };
    const commitImpl: GithubOrchestratorServices['commit'] = (input) => commitGithubStagedOperations(input, api);
    return { calls, commitImpl, BASE, NEXT, COMMIT };
  }

  it('puts two changed conversations into exactly one Git commit and one ref update', async () => {
    const remote = actualTransport();
    const { services } = fakeServices({
      rows: { 1: { conversation: chat(1) }, 2: { conversation: chat(2) } },
      commitImpl: remote.commitImpl,
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [1, 2] });
    expect(result.items.map((item) => item.status)).toEqual(['synced', 'synced']);
    expect(remote.calls.filter((call) => call.path.endsWith('/git/commits'))).toHaveLength(1);
    expect(remote.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    expect(remote.calls.find((call) => call.path.endsWith('/git/commits'))?.body.message).toBe(
      'SyncNos GitHub sync (2 items)',
    );
  });

  it('still commits the safe row when another conversation fails local projection', async () => {
    const remote = actualTransport();
    const { services } = fakeServices({
      rows: { 1: { conversation: chat(1) }, 2: { conversation: chat(2) } },
      messages: { 1: new Error('local read failed'), 2: [message('safe body')] },
      commitImpl: remote.commitImpl,
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [1, 2] });
    expect(result.items.map((item) => item.status)).toEqual(['failed', 'synced']);
    expect(remote.calls.filter((call) => call.path.endsWith('/git/commits'))).toHaveLength(1);
    expect(remote.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('does not enter Git transport at all when every row is a local no-op', async () => {
    const current = chat(1);
    const messages = [message('same body')];
    const p = await buildGithubMarkdownProjection({ conversation: current, messages, folders: settings });
    const mapping = {
      githubRemoteKey: preflight.remoteKey,
      githubProjectionFingerprint: p.projectionFingerprint,
      githubManagedFiles: {
        [p.markdownPath]: { kind: 'markdown', contentHash: p.markdownContentHash, sha: 'd'.repeat(40) },
      },
    };
    const { services, commit } = fakeServices({
      rows: { 1: { conversation: current, mapping } },
      messages: { 1: messages },
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [1] });
    expect(result.transport.status).toBe('not_needed');
    expect(result.items[0]?.status).toBe('no_changes');
    expect(commit).not.toHaveBeenCalled();
  });

  it('authoritative reconcile restores remote drift and remains commit-free when the tree is already authoritative', async () => {
    const current = chat(1);
    const messages = [message('same body')];
    const p = await buildGithubMarkdownProjection({ conversation: current, messages, folders: settings });
    const mapping = {
      githubRemoteKey: preflight.remoteKey,
      githubProjectionFingerprint: p.projectionFingerprint,
      githubManagedFiles: {
        [p.markdownPath]: { kind: 'markdown', contentHash: p.markdownContentHash, sha: 'd'.repeat(40) },
      },
    };

    const drifted = actualTransport(false);
    const driftedServices = fakeServices({
      rows: { 1: { conversation: current, mapping } },
      messages: { 1: messages },
      commitImpl: drifted.commitImpl,
    }).services;
    const driftedResult = await createGithubSyncOrchestrator(driftedServices).sync({
      conversationIds: [1],
      mode: 'reconcile',
    });
    expect(driftedResult.transport.status).toBe('committed');
    expect(drifted.calls.find((call) => call.path.endsWith('/git/trees'))?.body.tree).toEqual([
      { path: p.markdownPath, mode: '100644', type: 'blob', sha: 'd'.repeat(40) },
    ]);
    expect(drifted.calls.filter((call) => call.path.endsWith('/git/commits'))).toHaveLength(1);

    const currentRemote = actualTransport(true);
    const currentServices = fakeServices({
      rows: { 1: { conversation: current, mapping } },
      messages: { 1: messages },
      commitImpl: currentRemote.commitImpl,
    }).services;
    const currentResult = await createGithubSyncOrchestrator(currentServices).sync({
      conversationIds: [1],
      mode: 'reconcile',
    });
    expect(currentResult.transport.status).toBe('no_changes');
    expect(currentResult.items[0]?.status).toBe('synced');
    expect(currentRemote.calls.filter((call) => call.path.endsWith('/git/commits'))).toHaveLength(0);
    expect(currentRemote.calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('keeps same-target rename add/delete together while target switch never deletes the old target', async () => {
    const oldConversation = chat(1, { title: 'Old title' });
    const nextConversation = { ...oldConversation, title: 'New title' };
    const messages = [message('same body')];
    const oldProjection = await buildGithubMarkdownProjection({
      conversation: oldConversation,
      messages,
      folders: settings,
    });
    const mapping = {
      githubRemoteKey: preflight.remoteKey,
      githubProjectionFingerprint: oldProjection.projectionFingerprint,
      githubManagedFiles: {
        [oldProjection.markdownPath]: {
          kind: 'markdown',
          contentHash: oldProjection.markdownContentHash,
          sha: 'd'.repeat(40),
        },
      },
    };
    let renameOps: readonly any[] = [];
    const renameServices = fakeServices({
      rows: { 1: { conversation: nextConversation, mapping } },
      messages: { 1: messages },
      commitImpl: async ({ operations }) => {
        renameOps = operations;
        return {
          status: 'committed',
          treeSha: 'f'.repeat(40),
          commitSha: '1'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    }).services;
    await createGithubSyncOrchestrator(renameServices).sync({ conversationIds: [1] });
    expect(renameOps).toContainEqual(expect.objectContaining({ type: 'reuse', sha: 'd'.repeat(40) }));
    expect(renameOps).toContainEqual({ type: 'delete', path: oldProjection.markdownPath });

    let switchOps: readonly any[] = [];
    const switchServices = fakeServices({
      rows: {
        1: { conversation: nextConversation, mapping: { ...mapping, githubRemoteKey: 'github.com/old/repo@main' } },
      },
      messages: { 1: messages },
      commitImpl: async ({ operations }) => {
        switchOps = operations;
        return {
          status: 'committed',
          treeSha: 'f'.repeat(40),
          commitSha: '1'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    }).services;
    await createGithubSyncOrchestrator(switchServices).sync({ conversationIds: [1] });
    expect(switchOps.some((operation) => operation.type === 'delete')).toBe(false);
  });

  it('keeps text sync alive when image blob upload is outcome-unknown and exposes only a safe fallback warning', async () => {
    let committedMarkdown = '';
    const { services } = fakeServices({
      rows: { 1: { conversation: chat(1) } },
      messages: { 1: [message('before ![img](syncnos-asset://1) after')] },
      loadImage: async () => ({
        id: 1,
        conversationId: 1,
        url: 'https://cdn.example.com/image.png',
        blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
        byteSize: 1,
        contentType: 'image/png',
      }),
      createBlob: async () => {
        throw new GithubApiError('github_outcome_unknown', 0, 'github_outcome_unknown');
      },
      commitImpl: async ({ operations }) => {
        const write = operations.find((operation) => operation.type === 'write');
        committedMarkdown = write?.type === 'write' ? String(write.content) : '';
        return {
          status: 'committed',
          treeSha: 'f'.repeat(40),
          commitSha: '1'.repeat(40),
          files: resolvedFiles(operations),
        };
      },
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [1] });
    expect(result.items[0]?.status).toBe('synced');
    expect(result.items[0]?.warnings).toContain('image_upload_failed');
    expect(committedMarkdown).toContain('![img](https://cdn.example.com/image.png)');
    expect(committedMarkdown).not.toContain('syncnos-asset://');
  });

  it('self-heals continuity on the next run when ref update succeeded remotely but returned outcome-unknown', async () => {
    const current = chat(1);
    const messages = [message('authoritative body')];
    const projection = await buildGithubMarkdownProjection({ conversation: current, messages, folders: settings });
    const mapping = {
      githubRemoteKey: preflight.remoteKey,
      githubProjectionFingerprint: '0'.repeat(64),
      githubManagedFiles: {
        [projection.markdownPath]: { kind: 'markdown', contentHash: '1'.repeat(64), sha: 'a'.repeat(40) },
      },
    };
    const HEAD_1 = '2'.repeat(40);
    const BASE_1 = '3'.repeat(40);
    const NEW_TREE = '4'.repeat(40);
    const COMMIT = '5'.repeat(40);
    const DESIRED_BLOB = '6'.repeat(40);
    let head = HEAD_1;
    let commitCreates = 0;
    let refPatches = 0;
    const api = {
      async get<T>(path: string): Promise<T> {
        if (path.endsWith('/git/ref/heads/main')) return { object: { type: 'commit', sha: head } } as T;
        if (path.endsWith(`/git/commits/${HEAD_1}`)) return { tree: { sha: BASE_1 } } as T;
        if (path.endsWith(`/git/commits/${COMMIT}`)) return { tree: { sha: NEW_TREE } } as T;
        throw new Error(`unexpected:${path}`);
      },
      async post<T>(path: string, _body?: any): Promise<T> {
        if (path.endsWith('/git/blobs')) return { sha: DESIRED_BLOB } as T;
        if (path.endsWith('/git/trees')) return { sha: NEW_TREE } as T;
        if (path.endsWith('/git/commits')) {
          commitCreates += 1;
          return { sha: COMMIT } as T;
        }
        throw new Error(`unexpected:${path}`);
      },
      async patch<T>(): Promise<T> {
        refPatches += 1;
        head = COMMIT;
        throw new GithubApiError('github_outcome_unknown', 0, 'github_outcome_unknown');
      },
    };
    const commitImpl: GithubOrchestratorServices['commit'] = (input) => commitGithubStagedOperations(input, api);
    const { services } = fakeServices({
      rows: { 1: { conversation: current, mapping } },
      messages: { 1: messages },
      commitImpl,
    });
    const orchestrator = createGithubSyncOrchestrator(services);

    const first = await orchestrator.sync({ conversationIds: [1] });
    expect(first.transport.status).toBe('failed');
    expect(first.items[0]).toMatchObject({ status: 'failed', error: 'github_outcome_unknown' });
    expect(services.storage.patchSyncMapping).not.toHaveBeenCalled();
    expect(commitCreates).toBe(1);
    expect(refPatches).toBe(1);

    const second = await orchestrator.sync({ conversationIds: [1] });
    expect(second.transport.status).toBe('no_changes');
    expect(second.items[0]?.status).toBe('synced');
    expect(services.storage.patchSyncMapping).toHaveBeenCalledTimes(1);
    expect(commitCreates).toBe(1);
    expect(refPatches).toBe(1);
  });
});
