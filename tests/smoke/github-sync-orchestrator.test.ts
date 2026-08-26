import { describe, expect, it, vi } from 'vitest';

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
  now?: number;
}) {
  const defaultCommit: GithubOrchestratorServices['commit'] = async () => ({
    status: 'no_changes',
    treeSha: 'b'.repeat(40),
    files: [],
  });
  const commit = vi.fn(input.commitImpl ?? defaultCommit);
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
    loadImage: vi.fn(async () => null),
    createBlob: vi.fn(async () => ({ sha: 'c'.repeat(40) })),
    commit,
    now: () => input.now ?? 1234,
  };
  return { services, commit };
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
