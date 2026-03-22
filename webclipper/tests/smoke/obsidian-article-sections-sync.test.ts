import { afterEach, describe, expect, it, vi } from 'vitest';

const backgroundStorageMocks = vi.hoisted(() => ({
  getConversationById: vi.fn(),
  getMessagesByConversationId: vi.fn(),
  getArticleCommentsByConversationId: vi.fn(),
  attachOrphanArticleCommentsToConversation: vi.fn(),
}));

vi.mock('@services/conversations/background/storage', () => ({
  backgroundStorage: {
    getConversationById: backgroundStorageMocks.getConversationById,
    getMessagesByConversationId: backgroundStorageMocks.getMessagesByConversationId,
    getArticleCommentsByConversationId: backgroundStorageMocks.getArticleCommentsByConversationId,
    attachOrphanArticleCommentsToConversation: backgroundStorageMocks.attachOrphanArticleCommentsToConversation,
  },
}));

async function load(rel: string) {
  const mod = await import(/* @vite-ignore */ rel);
  return (mod as any).default || mod;
}

function setupChromeStorage() {
  const store: Record<string, unknown> = {};
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
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb && cb();
        },
      },
    },
  };
  return store;
}

describe('obsidian article sync replaces sections without duplicating headings', () => {
  it('dedupes duplicate Comments heading when syncing updates', async () => {
    setupChromeStorage();

    const settingsStore = await load('@services/sync/obsidian/settings-store.ts');
    await load('@services/sync/obsidian/obsidian-local-rest-client.ts');
    await load('@services/sync/obsidian/obsidian-note-path.ts');
    await load('@services/sync/obsidian/obsidian-sync-metadata.ts');
    await load('@services/sync/obsidian/obsidian-markdown-writer.ts');
    const orch = await load('@services/sync/obsidian/obsidian-sync-orchestrator.ts');

    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: 'article',
      source: 'web',
      conversationKey: 'k1',
      title: 't',
      url: 'https://example.com',
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: 'article_body', sequence: 1, role: 'assistant', contentMarkdown: 'New body', updatedAt: 1 },
    ]);
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
      {
        id: 2,
        parentId: 1,
        conversationId: 1,
        canonicalUrl: 'https://example.com',
        quoteText: '',
        commentText: 'Reply',
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    await settingsStore.saveObsidianSettings({
      enabled: true,
      apiBaseUrl: 'http://127.0.0.1:27123',
      apiKey: 'k',
    });

    const remoteMarkdownWithDupComments = [
      '---',
      'title: "t"',
      'syncnos:',
      '  source: "web"',
      '  conversationKey: "k1"',
      '  schemaVersion: 1',
      '  lastSyncedSequence: 1',
      '  lastSyncedMessageKey: "article_body"',
      '  lastSyncedMessageUpdatedAt: 1',
      '  lastSyncedAt: 1',
      '  articleDigest: "0"',
      '  commentsDigest: "0"',
      '---',
      '',
      '# t',
      '',
      '## Article',
      '',
      'Old body',
      '',
      '## Comments',
      '',
      '- Old comment',
      '',
      '## Comments',
      '',
      '- Duplicate comment section',
      '',
      '## Tail',
      '',
      'Keep tail',
      '',
    ].join('\n');

    let remoteFrontmatter: any = {
      syncnos: {
        source: 'web',
        conversationKey: 'k1',
        schemaVersion: 1,
        lastSyncedSequence: 1,
        lastSyncedMessageKey: 'article_body',
        lastSyncedMessageUpdatedAt: 1,
        lastSyncedAt: 1,
        articleDigest: '0',
        commentsDigest: '0',
      },
    };
    let lastPutBody = '';

    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const method = String(init?.method || 'GET').toUpperCase();
      const headers = init?.headers as Headers;
      const accept = headers?.get('Accept') || '';

      if (method === 'GET') {
        if (accept.includes('application/vnd.olrapi.note+json')) {
          return new Response(
            JSON.stringify({ frontmatter: remoteFrontmatter || {}, content: remoteMarkdownWithDupComments }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(remoteMarkdownWithDupComments, {
          status: 200,
          headers: { 'content-type': 'text/markdown' },
        });
      }

      if (method === 'PUT') {
        lastPutBody = String(init?.body || '');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (method === 'PATCH') {
        const targetType = headers?.get('Target-Type') || '';
        const target = headers?.get('Target') || '';
        if (targetType === 'frontmatter' && target === 'syncnos') {
          const body = String(init?.body || '');
          remoteFrontmatter = { syncnos: JSON.parse(body) };
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ errorCode: 40000, message: 'unexpected patch target' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ errorCode: 40000, message: 'unexpected method' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    };

    const res = await orch.syncConversations({ conversationIds: [1], instanceId: 'x' });
    expect(res.okCount).toBe(1);
    expect(res.results[0].ok).toBe(true);
    expect(lastPutBody).toContain('## Comments');
    expect(lastPutBody.match(/^##\s+Comments\s*$/gm)?.length || 0).toBe(1);
    expect(lastPutBody).toContain('> Quoted');
    expect(lastPutBody).toContain('- Root');
    expect(lastPutBody).toContain('  - Reply');
    expect(lastPutBody).not.toContain('## Tail');
    expect(lastPutBody).not.toContain('Keep tail');
  });
});

afterEach(() => {
  backgroundStorageMocks.getConversationById.mockReset();
  backgroundStorageMocks.getMessagesByConversationId.mockReset();
  backgroundStorageMocks.getArticleCommentsByConversationId.mockReset();
  backgroundStorageMocks.attachOrphanArticleCommentsToConversation.mockReset();
  // @ts-expect-error test cleanup
  delete globalThis.fetch;
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});
