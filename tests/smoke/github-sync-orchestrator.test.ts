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
}) {
  const commit = vi.fn(async () => ({ status: 'no_changes' as const, treeSha: 'b'.repeat(40), files: [] }));
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
      patchSyncMapping: vi.fn(async () => true),
    },
    loadImage: vi.fn(async () => null),
    createBlob: vi.fn(async () => ({ sha: 'c'.repeat(40) })),
    commit,
    now: () => 1234,
  };
  return { services, commit };
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
