import { describe, expect, it } from 'vitest';

import { GithubApiError } from '@services/sync/github/github-api-client';
import {
  commitGithubStagedOperations,
  commitGithubStagedOperationsOnce,
  createGithubBlob,
  resolveOwnedGithubDeletes,
  validateGithubGitPath,
  validateGithubStagedOperations,
} from '@services/sync/github/github-git-transport';

const ROOT = 'a'.repeat(40);
const TREE_A = 'b'.repeat(40);
const TREE_B = 'c'.repeat(40);
const BLOB_1 = 'd'.repeat(40);
const BLOB_2 = 'e'.repeat(40);

function createApi(trees: Record<string, unknown | Error>) {
  const calls: string[] = [];
  return {
    calls,
    api: {
      async get<T>(path: string): Promise<T> {
        calls.push(path);
        const sha = path.split('/').pop() || '';
        const value = trees[sha];
        if (value instanceof Error) throw value;
        if (value === undefined) throw new Error(`unexpected:${path}`);
        return value as T;
      },
    },
  };
}

function tree(entries: Array<{ path: string; type: 'blob' | 'tree'; sha: string }>, truncated = false) {
  return { truncated, tree: entries };
}

describe('github git transport staged path/delete resolver', () => {
  it('accepts safe relative paths and rejects traversal, absolute, control and workflows paths', () => {
    expect(validateGithubGitPath('AIChats/chat.md')).toBe('AIChats/chat.md');
    for (const invalid of [
      '',
      '/root.md',
      'a\\b.md',
      'a//b.md',
      'a/./b.md',
      'a/../b.md',
      ' a/b.md',
      'a/b.md ',
      'a/\u0000b.md',
      '.github/workflows',
      '.github/workflows/release.yml',
      '.GITHUB/WORKFLOWS/release.yml',
    ]) {
      expect(() => validateGithubGitPath(invalid)).toThrow('github_git_path_invalid');
    }
  });

  it('validates staged write/reuse/delete and normalizes reuse SHA only', () => {
    const operations = validateGithubStagedOperations([
      { type: 'write', path: 'a.md', content: 'hello' },
      { type: 'write', path: 'image.png', content: new Uint8Array([1, 2, 3]) },
      { type: 'reuse', path: 'reuse.md', sha: 'A'.repeat(40) },
      { type: 'delete', path: 'old.md' },
    ]);
    expect(operations[2]).toEqual({ type: 'reuse', path: 'reuse.md', sha: 'a'.repeat(40) });
    expect(() => validateGithubStagedOperations([{ type: 'reuse', path: 'a.md', sha: 'bad' }])).toThrow(
      'github_git_sha_invalid',
    );
  });

  it('resolves nested owned deletes and caches shared subtrees by SHA', async () => {
    const { api, calls } = createApi({
      [ROOT]: tree([{ path: 'folder', type: 'tree', sha: TREE_A }]),
      [TREE_A]: tree([{ path: 'nested', type: 'tree', sha: TREE_B }]),
      [TREE_B]: tree([
        { path: 'one.md', type: 'blob', sha: BLOB_1 },
        { path: 'two.md', type: 'blob', sha: BLOB_2 },
      ]),
    });

    const result = await resolveOwnedGithubDeletes(
      {
        repository: 'owner/repo',
        treeSha: ROOT,
        operations: [
          { type: 'delete', path: 'folder/nested/one.md' },
          { type: 'delete', path: 'folder/nested/two.md' },
          { type: 'write', path: 'new.md', content: 'new' },
        ],
      },
      api,
    );

    expect(result.deletes).toEqual([
      { path: 'folder/nested/one.md', status: 'present' },
      { path: 'folder/nested/two.md', status: 'present' },
    ]);
    expect(result.operations).toEqual([
      { type: 'delete', path: 'folder/nested/one.md' },
      { type: 'delete', path: 'folder/nested/two.md' },
      { type: 'write', path: 'new.md', content: 'new' },
    ]);
    expect(calls.filter((path) => path.endsWith(ROOT))).toHaveLength(1);
    expect(calls.filter((path) => path.endsWith(TREE_A))).toHaveLength(1);
    expect(calls.filter((path) => path.endsWith(TREE_B))).toHaveLength(1);
  });

  it('treats missing delete path as idempotent success and removes the mutation', async () => {
    const { api } = createApi({
      [ROOT]: tree([{ path: 'folder', type: 'tree', sha: TREE_A }]),
      [TREE_A]: tree([]),
    });
    const result = await resolveOwnedGithubDeletes(
      {
        repository: 'owner/repo',
        treeSha: ROOT,
        operations: [
          { type: 'delete', path: 'folder/missing.md' },
          { type: 'reuse', path: 'keep.md', sha: BLOB_1 },
        ],
      },
      api,
    );
    expect(result.deletes).toEqual([{ path: 'folder/missing.md', status: 'absent' }]);
    expect(result.operations).toEqual([{ type: 'reuse', path: 'keep.md', sha: BLOB_1 }]);
  });

  it('treats a file blocking an intermediate segment as absent rather than deleting the blocker', async () => {
    const { api } = createApi({
      [ROOT]: tree([{ path: 'folder', type: 'blob', sha: BLOB_1 }]),
    });
    const result = await resolveOwnedGithubDeletes(
      { repository: 'owner/repo', treeSha: ROOT, operations: [{ type: 'delete', path: 'folder/nested.md' }] },
      api,
    );
    expect(result).toEqual({ operations: [], deletes: [{ path: 'folder/nested.md', status: 'absent' }] });
  });

  it('fails safe on truncated, malformed, read-failed or non-blob final targets', async () => {
    for (const rootValue of [
      tree([{ path: 'old.md', type: 'blob', sha: BLOB_1 }], true),
      { truncated: false, tree: 'bad' },
      new Error('network'),
      tree([{ path: 'old.md', type: 'tree', sha: TREE_A }]),
      { truncated: false, tree: [{ path: 'old.md', type: 'commit', sha: TREE_A }] },
    ]) {
      const { api } = createApi({ [ROOT]: rootValue });
      const result = await resolveOwnedGithubDeletes(
        { repository: 'owner/repo', treeSha: ROOT, operations: [{ type: 'delete', path: 'old.md' }] },
        api,
      );
      expect(result).toEqual({
        operations: [],
        deletes: [{ path: 'old.md', status: 'failure' }],
      });
    }
  });

  it('stops the attempt on the first delete resolution failure', async () => {
    const { api, calls } = createApi({
      [ROOT]: tree([
        { path: 'bad', type: 'tree', sha: TREE_A },
        { path: 'later.md', type: 'blob', sha: BLOB_2 },
      ]),
      [TREE_A]: new Error('network'),
    });
    const result = await resolveOwnedGithubDeletes(
      {
        repository: 'owner/repo',
        treeSha: ROOT,
        operations: [
          { type: 'write', path: 'new.md', content: 'new' },
          { type: 'delete', path: 'bad/old.md' },
          { type: 'delete', path: 'later.md' },
        ],
      },
      api,
    );
    expect(result).toEqual({ operations: [], deletes: [{ path: 'bad/old.md', status: 'failure' }] });
    expect(calls.filter((path) => path.endsWith(ROOT))).toHaveLength(1);
  });

  it('fails safe on malformed matching subtree SHA instead of guessing', async () => {
    const { api } = createApi({
      [ROOT]: { truncated: false, tree: [{ path: 'folder', type: 'tree', sha: 'bad' }] },
    });
    const result = await resolveOwnedGithubDeletes(
      { repository: 'owner/repo', treeSha: ROOT, operations: [{ type: 'delete', path: 'folder/old.md' }] },
      api,
    );
    expect(result.deletes).toEqual([{ path: 'folder/old.md', status: 'failure' }]);
  });

  it('creates standalone text and binary blobs through the shared mutation primitive', async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const api = {
      async post<T>(path: string, body?: unknown): Promise<T> {
        calls.push({ path, body });
        return { sha: calls.length === 1 ? BLOB_1 : BLOB_2 } as T;
      },
    };
    await expect(createGithubBlob({ repository: 'owner/repo', content: 'héllo' }, api)).resolves.toEqual({
      sha: BLOB_1,
    });
    await expect(
      createGithubBlob({ repository: 'owner/repo', content: new Uint8Array([0, 255, 1]) }, api),
    ).resolves.toEqual({
      sha: BLOB_2,
    });
    expect(calls).toEqual([
      {
        path: '/repos/owner/repo/git/blobs',
        body: { content: 'héllo', encoding: 'utf-8' },
      },
      {
        path: '/repos/owner/repo/git/blobs',
        body: { content: 'AP8B', encoding: 'base64' },
      },
    ]);
  });

  it('does not retry standalone blob outcome-unknown', async () => {
    let calls = 0;
    const error = new GithubApiError('github_outcome_unknown', 0, 'github_outcome_unknown');
    const api = {
      async post<T>(): Promise<T> {
        calls += 1;
        throw error;
      },
    };
    await expect(createGithubBlob({ repository: 'owner/repo', content: 'body' }, api)).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  it('commits write/reuse/delete as one base-tree transaction and updates ref with force false', async () => {
    const NEW_TREE = '1'.repeat(40);
    const COMMIT = '2'.repeat(40);
    const calls: Array<{ method: string; path: string; body?: any }> = [];
    const api = {
      async get<T>(path: string): Promise<T> {
        calls.push({ method: 'GET', path });
        if (path.endsWith(ROOT)) return tree([{ path: 'old.md', type: 'blob', sha: BLOB_2 }]) as T;
        throw new Error(`unexpected:${path}`);
      },
      async post<T>(path: string, body?: unknown): Promise<T> {
        calls.push({ method: 'POST', path, body });
        if (path.endsWith('/git/blobs')) return { sha: BLOB_1 } as T;
        if (path.endsWith('/git/trees')) return { sha: NEW_TREE } as T;
        if (path.endsWith('/git/commits')) return { sha: COMMIT } as T;
        throw new Error(`unexpected:${path}`);
      },
      async patch<T>(path: string, body?: unknown): Promise<T> {
        calls.push({ method: 'PATCH', path, body });
        return { object: { sha: COMMIT } } as T;
      },
    };

    const result = await commitGithubStagedOperationsOnce(
      {
        repository: 'owner/repo',
        branch: 'feature/foo',
        headSha: 'f'.repeat(40),
        treeSha: ROOT,
        operations: [
          { type: 'write', path: 'new.md', content: 'body' },
          { type: 'reuse', path: 'asset.png', sha: BLOB_2 },
          { type: 'delete', path: 'old.md' },
        ],
      },
      api,
    );

    expect(result).toEqual({
      status: 'committed',
      files: [
        { path: 'new.md', status: 'written', sha: BLOB_1 },
        { path: 'asset.png', status: 'reused', sha: BLOB_2 },
        { path: 'old.md', status: 'deleted' },
      ],
    });
    const createTree = calls.find((call) => call.path.endsWith('/git/trees'));
    expect(createTree?.body).toEqual({
      base_tree: ROOT,
      tree: [
        { path: 'new.md', mode: '100644', type: 'blob', sha: BLOB_1 },
        { path: 'asset.png', mode: '100644', type: 'blob', sha: BLOB_2 },
        { path: 'old.md', mode: '100644', type: 'blob', sha: null },
      ],
    });
    const commit = calls.find((call) => call.path.endsWith('/git/commits'));
    expect(commit?.body).toEqual({
      message: 'SyncNos GitHub sync',
      tree: NEW_TREE,
      parents: ['f'.repeat(40)],
    });
    expect(JSON.stringify(commit?.body)).not.toMatch(/body|new\.md|old\.md/i);
    expect(calls.find((call) => call.method === 'PATCH')).toEqual({
      method: 'PATCH',
      path: '/repos/owner/repo/git/refs/heads/feature/foo',
      body: { sha: COMMIT, force: false },
    });
  });

  it('returns no_changes for absent deletes without creating tree/commit/ref', async () => {
    const calls: string[] = [];
    const api = {
      async get<T>(path: string): Promise<T> {
        calls.push(`GET ${path}`);
        return tree([]) as T;
      },
      async post<T>(path: string): Promise<T> {
        calls.push(`POST ${path}`);
        throw new Error('must-not-post');
      },
      async patch<T>(path: string): Promise<T> {
        calls.push(`PATCH ${path}`);
        throw new Error('must-not-patch');
      },
    };
    const result = await commitGithubStagedOperationsOnce(
      {
        repository: 'owner/repo',
        branch: 'main',
        headSha: 'f'.repeat(40),
        treeSha: ROOT,
        operations: [{ type: 'delete', path: 'missing.md' }],
      },
      api,
    );
    expect(result).toEqual({
      status: 'no_changes',
      files: [{ path: 'missing.md', status: 'absent' }],
    });
    expect(calls.some((call) => call.startsWith('POST') || call.startsWith('PATCH'))).toBe(false);
  });

  it('rejects an unchanged tree when a delete was proven present', async () => {
    let commits = 0;
    let patches = 0;
    const api = {
      async get<T>(path: string): Promise<T> {
        if (path.endsWith(ROOT)) return tree([{ path: 'old.md', type: 'blob', sha: BLOB_1 }]) as T;
        throw new Error(`unexpected:${path}`);
      },
      async post<T>(path: string): Promise<T> {
        if (path.endsWith('/git/trees')) return { sha: ROOT } as T;
        if (path.endsWith('/git/commits')) commits += 1;
        throw new Error(`unexpected:${path}`);
      },
      async patch<T>(): Promise<T> {
        patches += 1;
        throw new Error('unexpected patch');
      },
    };

    await expect(
      commitGithubStagedOperationsOnce(
        {
          repository: 'owner/repo',
          branch: 'main',
          headSha: 'f'.repeat(40),
          treeSha: ROOT,
          operations: [{ type: 'delete', path: 'old.md' }],
        },
        api,
      ),
    ).rejects.toMatchObject({ code: 'github_git_response_invalid' });
    expect(commits).toBe(0);
    expect(patches).toBe(0);
  });

  it('returns complete no_changes file resolution when GitHub tree equals base tree', async () => {
    let commits = 0;
    let patches = 0;
    const api = {
      async get<T>(): Promise<T> {
        throw new Error('no deletes');
      },
      async post<T>(path: string): Promise<T> {
        if (path.endsWith('/git/blobs')) return { sha: BLOB_1 } as T;
        if (path.endsWith('/git/trees')) return { sha: ROOT } as T;
        if (path.endsWith('/git/commits')) commits += 1;
        throw new Error(`unexpected:${path}`);
      },
      async patch<T>(): Promise<T> {
        patches += 1;
        throw new Error('unexpected patch');
      },
    };
    const result = await commitGithubStagedOperationsOnce(
      {
        repository: 'owner/repo',
        branch: 'main',
        headSha: 'f'.repeat(40),
        treeSha: ROOT,
        operations: [
          { type: 'write', path: 'same.md', content: 'same' },
          { type: 'reuse', path: 'same-asset.png', sha: BLOB_2 },
        ],
      },
      api,
    );
    expect(result).toEqual({
      status: 'no_changes',
      files: [
        { path: 'same.md', status: 'written', sha: BLOB_1 },
        { path: 'same-asset.png', status: 'reused', sha: BLOB_2 },
      ],
    });
    expect(commits).toBe(0);
    expect(patches).toBe(0);
  });

  it('does not convert ref outcome-unknown into an ackable success or retry it', async () => {
    const NEW_TREE = '1'.repeat(40);
    const COMMIT = '2'.repeat(40);
    let patchCalls = 0;
    const outcomeUnknown = new GithubApiError('github_outcome_unknown', 0, 'github_outcome_unknown');
    const api = {
      async get<T>(): Promise<T> {
        throw new Error('no deletes');
      },
      async post<T>(path: string): Promise<T> {
        if (path.endsWith('/git/trees')) return { sha: NEW_TREE } as T;
        if (path.endsWith('/git/commits')) return { sha: COMMIT } as T;
        throw new Error(`unexpected:${path}`);
      },
      async patch<T>(): Promise<T> {
        patchCalls += 1;
        throw outcomeUnknown;
      },
    };
    await expect(
      commitGithubStagedOperationsOnce(
        {
          repository: 'owner/repo',
          branch: 'main',
          headSha: 'f'.repeat(40),
          treeSha: ROOT,
          operations: [{ type: 'reuse', path: 'asset.png', sha: BLOB_2 }],
        },
        api,
      ),
    ).rejects.toBe(outcomeUnknown);
    expect(patchCalls).toBe(1);
  });

  it('re-resolves fresh HEAD/tree after a ref non-fast-forward race and succeeds on the next attempt', async () => {
    const HEAD_1 = '3'.repeat(40);
    const HEAD_2 = '4'.repeat(40);
    const BASE_1 = '5'.repeat(40);
    const BASE_2 = '6'.repeat(40);
    const NEW_1 = '7'.repeat(40);
    const NEW_2 = '8'.repeat(40);
    const COMMIT_1 = '9'.repeat(40);
    const COMMIT_2 = 'a'.repeat(40);
    let refReads = 0;
    let treeCreates = 0;
    let commitCreates = 0;
    let patches = 0;
    const treeBodies: any[] = [];
    const commitBodies: any[] = [];
    const patchBodies: any[] = [];
    const api = {
      async get<T>(path: string): Promise<T> {
        if (path === '/repos/owner/repo/git/ref/heads/main') {
          refReads += 1;
          return { object: { type: 'commit', sha: refReads === 1 ? HEAD_1 : HEAD_2 } } as T;
        }
        if (path.endsWith(HEAD_1)) return { tree: { sha: BASE_1 } } as T;
        if (path.endsWith(HEAD_2)) return { tree: { sha: BASE_2 } } as T;
        throw new Error(`unexpected:${path}`);
      },
      async post<T>(path: string, body?: unknown): Promise<T> {
        if (path.endsWith('/git/trees')) {
          treeCreates += 1;
          treeBodies.push(body);
          return { sha: treeCreates === 1 ? NEW_1 : NEW_2 } as T;
        }
        if (path.endsWith('/git/commits')) {
          commitCreates += 1;
          commitBodies.push(body);
          return { sha: commitCreates === 1 ? COMMIT_1 : COMMIT_2 } as T;
        }
        throw new Error(`unexpected:${path}`);
      },
      async patch<T>(_path: string, body?: unknown): Promise<T> {
        patches += 1;
        patchBodies.push(body);
        if (patches === 1) throw new GithubApiError('github_http_error', 422, 'Update is not a fast forward');
        return { object: { sha: COMMIT_2 } } as T;
      },
    };

    const result = await commitGithubStagedOperations(
      {
        repository: 'owner/repo',
        branch: 'main',
        operations: [{ type: 'reuse', path: 'asset.png', sha: BLOB_2 }],
      },
      api,
    );
    expect(result.status).toBe('committed');
    expect(refReads).toBe(2);
    expect(treeBodies.map((body) => body.base_tree)).toEqual([BASE_1, BASE_2]);
    expect(commitBodies.map((body) => body.message)).toEqual(['SyncNos GitHub sync', 'SyncNos GitHub sync']);
    expect(patchBodies).toEqual([
      { sha: COMMIT_1, force: false },
      { sha: COMMIT_2, force: false },
    ]);
  });

  it('does not retry validation or protected-branch failures', async () => {
    let reads = 0;
    const neverApi = {
      async get<T>(): Promise<T> {
        reads += 1;
        throw new Error('must-not-read');
      },
      async post<T>(): Promise<T> {
        throw new Error('must-not-post');
      },
      async patch<T>(): Promise<T> {
        throw new Error('must-not-patch');
      },
    };
    await expect(
      commitGithubStagedOperations(
        { repository: 'owner/repo', branch: 'main', operations: [{ type: 'delete', path: '../bad.md' }] },
        neverApi,
      ),
    ).rejects.toMatchObject({ code: 'github_git_path_invalid' });
    expect(reads).toBe(0);

    const HEAD = '3'.repeat(40);
    const BASE = '4'.repeat(40);
    const NEW_TREE = '5'.repeat(40);
    const COMMIT = '6'.repeat(40);
    let refReads = 0;
    let patchCalls = 0;
    const protectedError = new GithubApiError('github_http_error', 422, 'Protected branch update failed');
    const protectedApi = {
      async get<T>(path: string): Promise<T> {
        if (path.endsWith('/git/ref/heads/main')) {
          refReads += 1;
          return { object: { type: 'commit', sha: HEAD } } as T;
        }
        if (path.endsWith(HEAD)) return { tree: { sha: BASE } } as T;
        throw new Error(`unexpected:${path}`);
      },
      async post<T>(path: string): Promise<T> {
        if (path.endsWith('/git/trees')) return { sha: NEW_TREE } as T;
        if (path.endsWith('/git/commits')) return { sha: COMMIT } as T;
        throw new Error(`unexpected:${path}`);
      },
      async patch<T>(): Promise<T> {
        patchCalls += 1;
        throw protectedError;
      },
    };
    await expect(
      commitGithubStagedOperations(
        { repository: 'owner/repo', branch: 'main', operations: [{ type: 'reuse', path: 'asset.png', sha: BLOB_2 }] },
        protectedApi,
      ),
    ).rejects.toBe(protectedError);
    expect(refReads).toBe(1);
    expect(patchCalls).toBe(1);
  });

  it('exhausts branch-race retries at the fixed hard cap', async () => {
    const HEAD = '3'.repeat(40);
    const BASE = '4'.repeat(40);
    const NEW_TREE = '5'.repeat(40);
    const COMMIT = '6'.repeat(40);
    let refReads = 0;
    let patches = 0;
    const api = {
      async get<T>(path: string): Promise<T> {
        if (path.endsWith('/git/ref/heads/main')) {
          refReads += 1;
          return { object: { type: 'commit', sha: HEAD } } as T;
        }
        if (path.endsWith(HEAD)) return { tree: { sha: BASE } } as T;
        throw new Error(`unexpected:${path}`);
      },
      async post<T>(path: string): Promise<T> {
        if (path.endsWith('/git/trees')) return { sha: NEW_TREE } as T;
        if (path.endsWith('/git/commits')) return { sha: COMMIT } as T;
        throw new Error(`unexpected:${path}`);
      },
      async patch<T>(_path: string, body?: any): Promise<T> {
        patches += 1;
        expect(body.force).toBe(false);
        throw new GithubApiError('github_http_error', 422, 'Update is not a fast-forward');
      },
    };
    await expect(
      commitGithubStagedOperations(
        { repository: 'owner/repo', branch: 'main', operations: [{ type: 'reuse', path: 'asset.png', sha: BLOB_2 }] },
        api,
      ),
    ).rejects.toMatchObject({ code: 'github_git_branch_race_exhausted' });
    expect(refReads).toBe(3);
    expect(patches).toBe(3);
  });

  it('re-resolves deletes against the fresh tree and treats a concurrently removed path as satisfied', async () => {
    const HEAD_1 = '3'.repeat(40);
    const HEAD_2 = '4'.repeat(40);
    const BASE_1 = '5'.repeat(40);
    const BASE_2 = '6'.repeat(40);
    const NEW_1 = '7'.repeat(40);
    const COMMIT_1 = '8'.repeat(40);
    let refReads = 0;
    let patches = 0;
    const treeReads: string[] = [];
    const api = {
      async get<T>(path: string): Promise<T> {
        if (path.endsWith('/git/ref/heads/main')) {
          refReads += 1;
          return { object: { type: 'commit', sha: refReads === 1 ? HEAD_1 : HEAD_2 } } as T;
        }
        if (path.endsWith(HEAD_1)) return { tree: { sha: BASE_1 } } as T;
        if (path.endsWith(HEAD_2)) return { tree: { sha: BASE_2 } } as T;
        if (path.endsWith(BASE_1)) {
          treeReads.push(BASE_1);
          return tree([{ path: 'old.md', type: 'blob', sha: BLOB_1 }]) as T;
        }
        if (path.endsWith(BASE_2)) {
          treeReads.push(BASE_2);
          return tree([]) as T;
        }
        throw new Error(`unexpected:${path}`);
      },
      async post<T>(path: string): Promise<T> {
        if (path.endsWith('/git/trees')) return { sha: NEW_1 } as T;
        if (path.endsWith('/git/commits')) return { sha: COMMIT_1 } as T;
        throw new Error(`unexpected:${path}`);
      },
      async patch<T>(): Promise<T> {
        patches += 1;
        throw new GithubApiError('github_http_error', 422, 'Update is not a fast forward');
      },
    };
    const result = await commitGithubStagedOperations(
      { repository: 'owner/repo', branch: 'main', operations: [{ type: 'delete', path: 'old.md' }] },
      api,
    );
    expect(result).toEqual({
      status: 'no_changes',
      files: [{ path: 'old.md', status: 'absent' }],
    });
    expect(treeReads).toEqual([BASE_1, BASE_2]);
    expect(patches).toBe(1);
  });

  it('rejects invalid repository/root tree inputs before making any remote read', async () => {
    const { api, calls } = createApi({});
    await expect(
      resolveOwnedGithubDeletes(
        { repository: '../repo', treeSha: ROOT, operations: [{ type: 'delete', path: 'old.md' }] },
        api,
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(calls).toHaveLength(0);

    await expect(
      resolveOwnedGithubDeletes(
        { repository: 'owner/repo', treeSha: 'bad', operations: [{ type: 'delete', path: 'old.md' }] },
        api,
      ),
    ).rejects.toMatchObject({ code: 'github_git_sha_invalid' });
    expect(calls).toHaveLength(0);
  });
});
