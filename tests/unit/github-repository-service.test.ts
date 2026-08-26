import { describe, expect, it } from 'vitest';

import { GithubApiError } from '@services/sync/github/github-api-client';
import {
  GithubRepositoryError,
  discoverGithubRepositories,
  preflightGithubRepository,
} from '@services/sync/github/github-repository-service';

type Handler = (path: string) => unknown | Promise<unknown>;

function createApi(handler: Handler) {
  const calls: string[] = [];
  return {
    calls,
    api: {
      async get<T>(path: string): Promise<T> {
        calls.push(path);
        return (await handler(path)) as T;
      },
    },
  };
}

function installation(id: number, contents: unknown = 'write', appSlug: unknown = 'syncnos') {
  return { id, app_slug: appSlug, permissions: { contents } };
}

function repo(owner: string, name: string, permissions: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { owner: { login: owner }, name, private: false, permissions, ...extra };
}

function json404(): GithubApiError {
  return new GithubApiError('github_http_error', 404, 'Not Found');
}

describe('github repository service', () => {
  it('discovers only the SyncNos app installations and returns safe account metadata', async () => {
    const { api } = createApi((path) => {
      if (path === '/user') {
        return {
          login: 'chiimagnus',
          avatar_url: 'https://avatars.githubusercontent.com/u/1',
          html_url: 'https://github.com/chiimagnus',
          private_email: 'must-not-leak@example.com',
        };
      }
      if (path === '/user/installations?per_page=100&page=1') {
        return {
          installations: [installation(10), installation(20, 'write', 'another-app'), installation(30, 'write', null)],
        };
      }
      if (path === '/user/installations/10/repositories?per_page=100&page=1') {
        return { repositories: [repo('chiimagnus', 'RepoA', { push: true, pull: true })] };
      }
      throw new Error(`unexpected:${path}`);
    });

    const result = await discoverGithubRepositories(api);
    expect(result).toEqual({
      status: 'ready',
      account: {
        login: 'chiimagnus',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1',
        url: 'https://github.com/chiimagnus',
      },
      repositories: [
        {
          owner: 'chiimagnus',
          repo: 'RepoA',
          fullName: 'chiimagnus/RepoA',
          private: false,
          installationId: 10,
          userPermissions: { admin: false, maintain: false, push: true, pull: true, triage: false },
          installationContentsPermission: 'write',
          contentWriteCapable: true,
        },
      ],
      installUrl: 'https://github.com/apps/syncnos/installations/new',
      appUrl: 'https://github.com/apps/syncnos',
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak@example.com');
  });

  it('paginates installations and repositories, de-duplicates stably and prefers a write-capable duplicate', async () => {
    const firstInstallations = Array.from({ length: 100 }, (_, index) => installation(index + 1, 'read'));
    firstInstallations[0] = installation(1, 'write');
    const firstRepoPage = Array.from({ length: 100 }, (_, index) =>
      repo('owner', `repo-${String(index).padStart(3, '0')}`, { pull: true }),
    );

    const { api, calls } = createApi((path) => {
      if (path === '/user') return { login: 'user' };
      if (path === '/user/installations?per_page=100&page=1') return { installations: firstInstallations };
      if (path === '/user/installations?per_page=100&page=2') return { installations: [installation(101, 'write')] };
      if (path === '/user/installations/1/repositories?per_page=100&page=1') return { repositories: firstRepoPage };
      if (path === '/user/installations/1/repositories?per_page=100&page=2') {
        return { repositories: [repo('owner', 'shared', { push: true })] };
      }
      if (path === '/user/installations/101/repositories?per_page=100&page=1') {
        return { repositories: [repo('owner', 'shared', { push: true })] };
      }
      const match = /^\/user\/installations\/(\d+)\/repositories\?per_page=100&page=1$/.exec(path);
      if (match) return { repositories: [] };
      throw new Error(`unexpected:${path}`);
    });

    const result = await discoverGithubRepositories(api);
    const shared = result.repositories.find((item) => item.fullName === 'owner/shared');
    expect(shared).toMatchObject({
      installationId: 1,
      installationContentsPermission: 'write',
      contentWriteCapable: true,
    });
    expect(result.repositories.map((item) => item.fullName)).toEqual(
      [...result.repositories.map((item) => item.fullName)].sort((a, b) =>
        a.localeCompare(b, 'en', { sensitivity: 'base' }),
      ),
    );
    expect(calls).toContain('/user/installations?per_page=100&page=2');
    expect(calls).toContain('/user/installations/1/repositories?per_page=100&page=2');
  });

  it('reports app-not-installed and no-accessible-repositories separately', async () => {
    const notInstalled = createApi((path) => {
      if (path === '/user') return { login: 'user' };
      if (path.startsWith('/user/installations?')) return { installations: [] };
      throw new Error(`unexpected:${path}`);
    });
    expect(await discoverGithubRepositories(notInstalled.api)).toMatchObject({
      status: 'github_app_not_installed',
      repositories: [],
    });

    const noRepos = createApi((path) => {
      if (path === '/user') return { login: 'user' };
      if (path.startsWith('/user/installations?')) return { installations: [installation(1)] };
      if (path.startsWith('/user/installations/1/repositories?')) return { repositories: [] };
      throw new Error(`unexpected:${path}`);
    });
    expect(await discoverGithubRepositories(noRepos.api)).toMatchObject({
      status: 'github_no_accessible_repositories',
      repositories: [],
    });
  });

  it.each([
    [{ admin: true }, true],
    [{ maintain: true }, true],
    [{ push: true }, true],
    [{ pull: true }, false],
    [{ triage: true }, false],
    [{ role_name: 'custom-writer' }, false],
  ])('fails closed for user repository permission shape %#', async (permissions, expectedWrite) => {
    const { api } = createApi((path) => {
      if (path === '/user') return { login: 'user' };
      if (path.startsWith('/user/installations?')) return { installations: [installation(1, 'write')] };
      if (path.startsWith('/user/installations/1/repositories?')) {
        return { repositories: [repo('owner', 'repo', permissions)] };
      }
      throw new Error(`unexpected:${path}`);
    });
    const result = await discoverGithubRepositories(api);
    expect(result.repositories[0].contentWriteCapable).toBe(expectedWrite);
  });

  it('preflight distinguishes app contents permission from user write permission', async () => {
    const makeApi = (contents: unknown, permissions: Record<string, unknown>) =>
      createApi((path) => {
        if (path === '/user') return { login: 'user' };
        if (path.startsWith('/user/installations?')) return { installations: [installation(1, contents)] };
        if (path.startsWith('/user/installations/1/repositories?'))
          return { repositories: [repo('owner', 'repo', permissions)] };
        throw new Error(`unexpected:${path}`);
      }).api;

    await expect(
      preflightGithubRepository({ repository: 'owner/repo', branch: '' }, makeApi('read', { push: true })),
    ).rejects.toMatchObject({
      code: 'github_app_contents_write_required',
    });
    await expect(
      preflightGithubRepository({ repository: 'owner/repo', branch: '' }, makeApi('write', { pull: true })),
    ).rejects.toMatchObject({
      code: 'github_repository_write_required',
    });
  });

  it('preflights default branch and returns canonical remote/head/tree identity', async () => {
    const { api, calls } = createApi((path) => {
      if (path === '/user') return { login: 'user' };
      if (path.startsWith('/user/installations?')) return { installations: [installation(7)] };
      if (path.startsWith('/user/installations/7/repositories?')) {
        return { repositories: [repo('Owner', 'Repo', { push: true })] };
      }
      if (path === '/repos/Owner/Repo') return { default_branch: 'main' };
      if (path === '/repos/Owner/Repo/git/ref/heads/main') return { object: { type: 'commit', sha: 'a'.repeat(40) } };
      if (path === `/repos/Owner/Repo/git/commits/${'a'.repeat(40)}`) return { tree: { sha: 'b'.repeat(40) } };
      throw new Error(`unexpected:${path}`);
    });

    await expect(preflightGithubRepository({ repository: ' Owner / Repo ', branch: '' }, api)).resolves.toEqual({
      repository: 'Owner/Repo',
      branch: 'main',
      remoteKey: 'github.com/Owner/Repo@main',
      installationId: 7,
      headSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
    });
    expect(calls).toContain('/repos/Owner/Repo/git/ref/heads/main');
  });

  it('uses explicit nested branch and encodes each branch segment safely', async () => {
    const branch = 'feature/百分比%';
    const encodedBranch = 'feature/%E7%99%BE%E5%88%86%E6%AF%94%25';
    const { api, calls } = createApi((path) => {
      if (path === '/user') return { login: 'user' };
      if (path.startsWith('/user/installations?')) return { installations: [installation(1)] };
      if (path.startsWith('/user/installations/1/repositories?')) {
        return { repositories: [repo('owner', 'repo', { maintain: true })] };
      }
      if (path === '/repos/owner/repo') return { default_branch: 'main' };
      if (path === `/repos/owner/repo/git/ref/heads/${encodedBranch}`) {
        return { object: { type: 'commit', sha: 'c'.repeat(40) } };
      }
      if (path === `/repos/owner/repo/git/commits/${'c'.repeat(40)}`) return { tree: { sha: 'd'.repeat(40) } };
      throw new Error(`unexpected:${path}`);
    });

    const result = await preflightGithubRepository({ repository: 'owner/repo', branch }, api);
    expect(result.branch).toBe(branch);
    expect(calls).toContain(`/repos/owner/repo/git/ref/heads/${encodedBranch}`);
  });

  it('keeps configured repo on permission loss by returning not-accessible instead of selecting another repo', async () => {
    const { api } = createApi((path) => {
      if (path === '/user') return { login: 'user' };
      if (path.startsWith('/user/installations?')) return { installations: [installation(1)] };
      if (path.startsWith('/user/installations/1/repositories?')) {
        return { repositories: [repo('owner', 'other', { push: true })] };
      }
      throw new Error(`unexpected:${path}`);
    });
    await expect(preflightGithubRepository({ repository: 'owner/repo', branch: '' }, api)).rejects.toMatchObject({
      code: 'github_repository_not_accessible',
    });
  });

  it('distinguishes empty repository, missing explicit branch and private-style 404 without claiming nonexistence', async () => {
    const base = (tail: Handler) =>
      createApi((path) => {
        if (path === '/user') return { login: 'user' };
        if (path.startsWith('/user/installations?')) return { installations: [installation(1)] };
        if (path.startsWith('/user/installations/1/repositories?')) {
          return { repositories: [repo('owner', 'repo', { push: true }, { private: true })] };
        }
        return tail(path);
      }).api;

    await expect(
      preflightGithubRepository(
        { repository: 'owner/repo', branch: '' },
        base((path) => {
          if (path === '/repos/owner/repo') return { default_branch: null };
          throw new Error(`unexpected:${path}`);
        }),
      ),
    ).rejects.toMatchObject({ code: 'github_repository_uninitialized' });

    await expect(
      preflightGithubRepository(
        { repository: 'owner/repo', branch: 'feature/missing' },
        base((path) => {
          if (path === '/repos/owner/repo') return { default_branch: 'main' };
          if (path === '/repos/owner/repo/git/ref/heads/feature/missing') throw json404();
          throw new Error(`unexpected:${path}`);
        }),
      ),
    ).rejects.toMatchObject({ code: 'github_branch_not_found' });

    await expect(
      preflightGithubRepository(
        { repository: 'owner/repo', branch: '' },
        base((path) => {
          if (path === '/repos/owner/repo') throw json404();
          throw new Error(`unexpected:${path}`);
        }),
      ),
    ).rejects.toMatchObject({ code: 'github_repository_not_accessible' });
  });

  it('rejects a Git ref response with a valid SHA but missing object.type', async () => {
    const { api } = createApi((path) => {
      if (path === '/user') return { login: 'user' };
      if (path.startsWith('/user/installations?')) return { installations: [installation(1)] };
      if (path.startsWith('/user/installations/1/repositories?')) {
        return { repositories: [repo('owner', 'repo', { push: true })] };
      }
      if (path === '/repos/owner/repo') return { default_branch: 'main' };
      if (path === '/repos/owner/repo/git/ref/heads/main') return { object: { sha: 'a'.repeat(40) } };
      if (path === `/repos/owner/repo/git/commits/${'a'.repeat(40)}`) return { tree: { sha: 'b'.repeat(40) } };
      throw new Error(`unexpected:${path}`);
    });

    await expect(preflightGithubRepository({ repository: 'owner/repo', branch: '' }, api)).rejects.toMatchObject({
      code: 'github_repository_response_invalid',
    });
  });

  it('rejects malformed GitHub response shapes and invalid SHA/type fail-closed', async () => {
    const invalidInstallations = createApi((path) => {
      if (path === '/user') return { login: 'user' };
      if (path.startsWith('/user/installations?')) return { installations: 'bad' };
      throw new Error(`unexpected:${path}`);
    });
    await expect(discoverGithubRepositories(invalidInstallations.api)).rejects.toBeInstanceOf(GithubRepositoryError);

    const { api } = createApi((path) => {
      if (path === '/user') return { login: 'user' };
      if (path.startsWith('/user/installations?')) return { installations: [installation(1)] };
      if (path.startsWith('/user/installations/1/repositories?'))
        return { repositories: [repo('owner', 'repo', { push: true })] };
      if (path === '/repos/owner/repo') return { default_branch: 'main' };
      if (path === '/repos/owner/repo/git/ref/heads/main') return { object: { type: 'tag', sha: 'not-a-sha' } };
      throw new Error(`unexpected:${path}`);
    });
    await expect(preflightGithubRepository({ repository: 'owner/repo', branch: '' }, api)).rejects.toMatchObject({
      code: 'github_repository_response_invalid',
    });
  });
});
