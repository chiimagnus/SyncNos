import { describe, expect, it, vi } from 'vitest';

import type { GithubCleanupOutboxRecord } from '@platform/idb/github-cleanup-outbox-record';
import { GithubApiError } from '@services/sync/github/github-api-client';
import { commitGithubStagedOperations } from '@services/sync/github/github-git-transport';
import { buildGithubMarkdownProjection } from '@services/sync/github/github-markdown-projection';
import type { GithubOrchestratorServices } from '@services/sync/github/github-orchestrator-services';
import { createGithubSyncOrchestrator } from '@services/sync/github/github-sync-orchestrator';

const settings = {
  repository: 'owner/repo',
  branch: 'main',
  chatFolder: 'Chats',
  articleFolder: 'Articles',
  videoFolder: 'Videos',
  defaults: {
    repository: '',
    branch: '',
    chatFolder: 'SyncNos-AIChats',
    articleFolder: 'SyncNos-WebArticles',
    videoFolder: 'SyncNos-Videos',
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
}) {
  const defaultCommit: GithubOrchestratorServices['commit'] = async () => ({
    status: 'no_changes',
    treeSha: 'b'.repeat(40),
    files: [],
  });
  const commit = vi.fn(input.commitImpl ?? defaultCommit);
  let cleanupRows = (input.cleanupRows ?? []).map((row) => ({ ...row, paths: [...row.paths] }));
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
    replacementDeferMs: input.replacementDeferMs ?? 5_000,
    now: () => input.now ?? 1234,
  };
  return { services, commit, getCleanupRows: () => cleanupRows.map((row) => ({ ...row, paths: [...row.paths] })) };
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

describe('github sync orchestrator staging', () => {
  it('dedupes candidate ids and resolves the target exactly once', async () => {
    const { services } = fakeServices({ rows: { 1: { conversation: chat(1) }, 2: { conversation: chat(2) } } });
    const result = await createGithubSyncOrchestrator(services).stage({ conversationIds: [1, 1, 2, 0, 'bad'] });

    expect(services.preflight).toHaveBeenCalledTimes(1);
    expect(services.preflight).toHaveBeenCalledWith({ repository: settings.repository, branch: settings.branch });
    expect(services.getSettings).toHaveBeenCalledTimes(1);
    expect(services.storage.getSyncMappingByConversation).toHaveBeenCalledTimes(2);
    expect(result.summary.candidateCount).toBe(2);
    expect(result.summary.stagedCount).toBe(2);
  });

  it('reattaches article orphans before reading comments by conversation id only', async () => {
    const order: string[] = [];
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
    });
    const result = await createGithubSyncOrchestrator(services).stage({ conversationIds: [3] });

    expect(order).toEqual(['attach:3', 'comments:3']);
    expect(services.storage.attachOrphanArticleCommentsToConversation).toHaveBeenCalledWith(article.url, 3);
    expect(services.storage.getArticleCommentsByConversationId).toHaveBeenCalledWith(3);
    const write = result.operations.find((operation) => operation.type === 'write');
    expect(write?.type === 'write' ? String(write.content) : '').toContain('Owned comment');
  });

  it('isolates one local projection failure and keeps other safe staged rows', async () => {
    const { services } = fakeServices({
      rows: { 1: { conversation: chat(1) }, 2: { conversation: chat(2) } },
      messages: { 1: new Error('broken local read'), 2: [message('safe body')] },
    });
    const result = await createGithubSyncOrchestrator(services).stage({ conversationIds: [1, 2] });

    expect(result.items.find((item) => item.conversationId === 1)?.status).toBe('failed');
    expect(result.items.find((item) => item.conversationId === 2)?.status).toBe('staged');
    expect(result.operations).toHaveLength(1);
  });

  it('dedupes identical content staged to the same path', async () => {
    const sharedIdentity = {
      source: 'chatgpt',
      conversationKey: 'same-key',
      title: 'Same title',
      url: 'https://example.com/same',
    };
    const { services } = fakeServices({
      rows: {
        1: { conversation: chat(1, sharedIdentity) },
        2: { conversation: chat(2, sharedIdentity) },
      },
      messages: { 1: [message('same body')], 2: [message('same body')] },
    });
    const result = await createGithubSyncOrchestrator(services).stage({ conversationIds: [1, 2] });

    expect(result.items.every((item) => item.status === 'staged')).toBe(true);
    expect(result.operations).toHaveLength(1);
  });

  it('fails every conversation participating in a conflicting staged path and removes their whole rows', async () => {
    const sharedIdentity = {
      source: 'chatgpt',
      conversationKey: 'same-key',
      title: 'Same title',
      url: 'https://example.com/same',
    };
    const { services } = fakeServices({
      rows: {
        1: { conversation: chat(1, sharedIdentity) },
        2: { conversation: chat(2, sharedIdentity) },
      },
      messages: { 1: [message('first body')], 2: [message('second body')] },
    });
    const result = await createGithubSyncOrchestrator(services).stage({ conversationIds: [1, 2] });

    expect(result.operations).toEqual([]);
    expect(result.items.map((item) => [item.conversationId, item.status, item.error])).toEqual([
      [1, 'failed', 'github_staged_path_collision'],
      [2, 'failed', 'github_staged_path_collision'],
    ]);
  });

  it('returns all-local-no-op without invoking transport', async () => {
    const conversation = chat(1);
    const messages = [message('same body')];
    const p = await buildGithubMarkdownProjection({ conversation, messages, folders: settings });
    const mapping = {
      githubRemoteKey: preflight.remoteKey,
      githubProjectionFingerprint: p.projectionFingerprint,
      githubManagedFiles: {
        [p.markdownPath]: { kind: 'markdown', contentHash: p.markdownContentHash, sha: 'd'.repeat(40) },
      },
    };
    const { services, commit } = fakeServices({ rows: { 1: { conversation, mapping } }, messages: { 1: messages } });
    const result = await createGithubSyncOrchestrator(services).stage({ conversationIds: [1] });

    expect(result.operations).toEqual([]);
    expect(result.items[0]?.status).toBe('no_changes');
    expect(commit).not.toHaveBeenCalled();
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

  it('allows identity cleanup after same-target replacement success or local replacement deletion', async () => {
    let committedOperations: readonly any[] = [];
    const { services, getCleanupRows } = fakeServices({
      rows: {
        2: {
          conversation: chat(2),
          mapping: { githubRemoteKey: preflight.remoteKey, githubLastSyncedAt: 100, githubManagedFiles: {} },
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

  it('keeps a successful remote result when local cleanup acknowledgement fails', async () => {
    const { services, getCleanupRows } = fakeServices({
      rows: {},
      cleanupRows: [cleanupRow(12)],
      commitImpl: async ({ operations }) => ({
        status: 'committed',
        treeSha: 'f'.repeat(40),
        commitSha: '1'.repeat(40),
        files: resolvedFiles(operations),
      }),
    });
    services.ackCleanupRows = vi.fn(async () => {
      throw new Error('local ack failed');
    });

    const result = await createGithubSyncOrchestrator(services).sync({ conversationIds: [] });

    expect(result.transport).toEqual({ status: 'committed', commitSha: '1'.repeat(40) });
    expect(result.cleanupWarnings).toContain('github_cleanup_ack_failed');
    expect(getCleanupRows()).toHaveLength(1);
    expect(result.nextCleanupDueAt).toBe(1);
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
      async post<T>(path: string, body?: any): Promise<T> {
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
