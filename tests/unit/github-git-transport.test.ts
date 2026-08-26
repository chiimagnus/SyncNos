import { describe, expect, it } from 'vitest';

import {
  GithubGitTransportError,
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
    expect(validateGithubGitPath('SyncNos-AIChats/chat.md')).toBe('SyncNos-AIChats/chat.md');
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
      { path: 'folder/nested/one.md', status: 'present', sha: BLOB_1 },
      { path: 'folder/nested/two.md', status: 'present', sha: BLOB_2 },
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
    ).rejects.toBeInstanceOf(GithubGitTransportError);
    expect(calls).toHaveLength(0);
  });
});
