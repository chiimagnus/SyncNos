import { githubApiClient } from '@services/sync/github/github-api-client';
import { encodeGithubRepositoryPath, normalizeGithubRepository } from '@services/sync/github/settings-store';

const GIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export type GithubStagedWriteOperation = {
  type: 'write';
  path: string;
  content: string | Uint8Array;
};

export type GithubStagedReuseOperation = {
  type: 'reuse';
  path: string;
  sha: string;
};

export type GithubStagedDeleteOperation = {
  type: 'delete';
  path: string;
};

export type GithubStagedOperation =
  | GithubStagedWriteOperation
  | GithubStagedReuseOperation
  | GithubStagedDeleteOperation;

export type GithubDeleteResolution =
  | { path: string; status: 'present'; sha: string }
  | { path: string; status: 'absent' }
  | { path: string; status: 'failure' };

export type GithubOwnedDeleteResolution = {
  operations: GithubStagedOperation[];
  deletes: GithubDeleteResolution[];
};

export type GithubGitTransportErrorCode = 'github_git_path_invalid' | 'github_git_sha_invalid';

export class GithubGitTransportError extends Error {
  constructor(readonly code: GithubGitTransportErrorCode) {
    super(code);
    this.name = 'GithubGitTransportError';
  }
}

type GithubApiReader = {
  get<T>(path: string): Promise<T>;
};

type GitTreeEntry = {
  path: string;
  type: 'blob' | 'tree' | 'other';
  sha: string;
};

type ParsedTree = {
  entries: Map<string, GitTreeEntry>;
};

function requireGitSha(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || !GIT_SHA_RE.test(value)) {
    throw new GithubGitTransportError('github_git_sha_invalid');
  }
  return value.toLowerCase();
}

export function validateGithubGitPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new GithubGitTransportError('github_git_path_invalid');
  }
  if (value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new GithubGitTransportError('github_git_path_invalid');
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new GithubGitTransportError('github_git_path_invalid');
  }
  const lower = value.toLowerCase();
  if (lower === '.github/workflows' || lower.startsWith('.github/workflows/')) {
    throw new GithubGitTransportError('github_git_path_invalid');
  }
  return value;
}

export function validateGithubStagedOperations(operations: readonly GithubStagedOperation[]): GithubStagedOperation[] {
  if (!Array.isArray(operations)) throw new GithubGitTransportError('github_git_path_invalid');
  return operations.map((operation) => {
    if (!operation || typeof operation !== 'object') throw new GithubGitTransportError('github_git_path_invalid');
    const path = validateGithubGitPath(operation.path);
    if (operation.type === 'write') {
      if (typeof operation.content !== 'string' && !(operation.content instanceof Uint8Array)) {
        throw new GithubGitTransportError('github_git_path_invalid');
      }
      return { ...operation, path };
    }
    if (operation.type === 'reuse') return { ...operation, path, sha: requireGitSha(operation.sha) };
    if (operation.type === 'delete') return { ...operation, path };
    throw new GithubGitTransportError('github_git_path_invalid');
  });
}

function parseTree(value: unknown): ParsedTree | null {
  const raw = value as any;
  if (!raw || typeof raw !== 'object' || raw.truncated !== false || !Array.isArray(raw.tree)) return null;
  const entries = new Map<string, GitTreeEntry>();
  for (const item of raw.tree) {
    if (!item || typeof item !== 'object' || typeof item.path !== 'string') return null;
    if (item.path.includes('/') || !item.path || item.path === '.' || item.path === '..') return null;
    if (typeof item.sha !== 'string' || !GIT_SHA_RE.test(item.sha)) return null;
    if (entries.has(item.path)) return null;
    const type = item.type === 'blob' || item.type === 'tree' ? item.type : 'other';
    entries.set(item.path, { path: item.path, type, sha: item.sha.toLowerCase() });
  }
  return { entries };
}

export async function resolveOwnedGithubDeletes(
  input: { repository: string; treeSha: string; operations: readonly GithubStagedOperation[] },
  api: GithubApiReader = githubApiClient,
): Promise<GithubOwnedDeleteResolution> {
  const repository = normalizeGithubRepository(input.repository);
  if (!repository) throw new GithubGitTransportError('github_git_path_invalid');
  const encodedRepository = encodeGithubRepositoryPath(repository);
  const rootTreeSha = requireGitSha(input.treeSha);
  const operations = validateGithubStagedOperations(input.operations);
  const treeCache = new Map<string, ParsedTree | null>();

  async function getTree(sha: string): Promise<ParsedTree | null> {
    if (treeCache.has(sha)) return treeCache.get(sha) ?? null;
    try {
      const raw = await api.get<any>(`/repos/${encodedRepository}/git/trees/${encodeURIComponent(sha)}`);
      const parsed = parseTree(raw);
      treeCache.set(sha, parsed);
      return parsed;
    } catch (_error) {
      treeCache.set(sha, null);
      return null;
    }
  }

  async function resolveDelete(path: string): Promise<GithubDeleteResolution> {
    const segments = path.split('/');
    let currentTreeSha = rootTreeSha;
    for (let index = 0; index < segments.length; index += 1) {
      const tree = await getTree(currentTreeSha);
      if (!tree) return { path, status: 'failure' };
      const entry = tree.entries.get(segments[index]);
      if (!entry) return { path, status: 'absent' };
      const final = index === segments.length - 1;
      if (final) {
        if (entry.type !== 'blob') return { path, status: 'failure' };
        return { path, status: 'present', sha: entry.sha };
      }
      if (entry.type === 'blob') return { path, status: 'absent' };
      if (entry.type !== 'tree') return { path, status: 'failure' };
      currentTreeSha = entry.sha;
    }
    return { path, status: 'failure' };
  }

  const deletes: GithubDeleteResolution[] = [];
  const kept: GithubStagedOperation[] = [];
  for (const operation of operations) {
    if (operation.type !== 'delete') {
      kept.push(operation);
      continue;
    }
    const resolution = await resolveDelete(operation.path);
    deletes.push(resolution);
    if (resolution.status === 'failure') return { operations: [], deletes };
    if (resolution.status === 'present') kept.push(operation);
  }
  return { operations: kept, deletes };
}
