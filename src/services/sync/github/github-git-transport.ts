import { hasAsciiControlCharacter } from '@platform/validation/ascii-control';
import { GithubApiError, githubApiClient } from '@services/sync/github/github-api-client';
import {
  encodeGithubBranchPath,
  encodeGithubRepositoryPath,
  normalizeGithubBranch,
  normalizeGithubRepository,
} from '@services/sync/github/settings-store';

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

export type GithubGitTransportErrorCode =
  | 'github_git_path_invalid'
  | 'github_git_branch_invalid'
  | 'github_git_message_invalid'
  | 'github_git_sha_invalid'
  | 'github_git_delete_resolution_failed'
  | 'github_git_response_invalid'
  | 'github_git_branch_race'
  | 'github_git_branch_race_exhausted';

export class GithubGitTransportError extends Error {
  constructor(readonly code: GithubGitTransportErrorCode) {
    super(code);
    this.name = 'GithubGitTransportError';
  }
}

type GithubApiReader = {
  get<T>(path: string): Promise<T>;
};

type GithubGitApi = GithubApiReader & {
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
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

function requireResponseGitSha(value: unknown): string {
  if (typeof value !== 'string' || !GIT_SHA_RE.test(value)) {
    throw new GithubGitTransportError('github_git_response_invalid');
  }
  return value.toLowerCase();
}

function normalizeGithubCommitMessage(value: unknown, fallback: string): string {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 160) {
    throw new GithubGitTransportError('github_git_message_invalid');
  }
  if (hasAsciiControlCharacter(value)) throw new GithubGitTransportError('github_git_message_invalid');
  return value;
}

export function validateGithubGitPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new GithubGitTransportError('github_git_path_invalid');
  }
  if (value.startsWith('/') || value.includes('\\') || hasAsciiControlCharacter(value)) {
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

export type GithubFinalFileResolution =
  | { path: string; status: 'written' | 'reused'; sha: string }
  | { path: string; status: 'deleted' | 'absent' };

export type GithubGitTransactionResult =
  | {
      status: 'no_changes';
      treeSha: string;
      files: GithubFinalFileResolution[];
    }
  | {
      status: 'committed';
      treeSha: string;
      commitSha: string;
      files: GithubFinalFileResolution[];
    };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function createGithubBlob(
  input: { repository: string; content: string | Uint8Array },
  api: Pick<GithubGitApi, 'post'> = githubApiClient,
): Promise<{ sha: string }> {
  const repository = normalizeGithubRepository(input.repository);
  if (!repository) throw new GithubGitTransportError('github_git_path_invalid');
  const encodedRepository = encodeGithubRepositoryPath(repository);
  let body: { content: string; encoding: 'base64' | 'utf-8' };
  if (input.content instanceof Uint8Array) {
    body = { content: bytesToBase64(input.content), encoding: 'base64' };
  } else if (typeof input.content === 'string') {
    body = { content: input.content, encoding: 'utf-8' };
  } else {
    throw new GithubGitTransportError('github_git_path_invalid');
  }
  const response = await api.post<any>(`/repos/${encodedRepository}/git/blobs`, body);
  return { sha: requireResponseGitSha(response?.sha) };
}

function isRefBranchRace(error: unknown): boolean {
  return (
    error instanceof GithubApiError &&
    error.status === 422 &&
    /(?:not (?:a )?fast[- ]forward|non-fast[- ]forward)/i.test(error.safeMessage)
  );
}

export async function commitGithubStagedOperationsOnce(
  input: {
    repository: string;
    branch: string;
    headSha: string;
    treeSha: string;
    operations: readonly GithubStagedOperation[];
    message?: string;
  },
  api: GithubGitApi = githubApiClient,
): Promise<GithubGitTransactionResult> {
  const repository = normalizeGithubRepository(input.repository);
  if (!repository) throw new GithubGitTransportError('github_git_path_invalid');
  const branch = normalizeGithubBranch(input.branch);
  if (!branch) throw new GithubGitTransportError('github_git_branch_invalid');
  const encodedRepository = encodeGithubRepositoryPath(repository);
  const encodedBranch = encodeGithubBranchPath(branch);
  const headSha = requireGitSha(input.headSha);
  const baseTreeSha = requireGitSha(input.treeSha);
  const operations = validateGithubStagedOperations(input.operations);
  const customMessage = input.message == null ? null : normalizeGithubCommitMessage(input.message, '');

  const deleteResolution = await resolveOwnedGithubDeletes({ repository, treeSha: baseTreeSha, operations }, api);
  if (deleteResolution.deletes.some((item) => item.status === 'failure')) {
    throw new GithubGitTransportError('github_git_delete_resolution_failed');
  }
  const deleteByPath = new Map(deleteResolution.deletes.map((item) => [item.path, item] as const));
  const blobByPath = new Map<string, { status: 'written' | 'reused'; sha: string }>();
  const treeEntries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string | null }> = [];

  for (const operation of deleteResolution.operations) {
    if (operation.type === 'write') {
      const blob = await createGithubBlob({ repository, content: operation.content }, api);
      blobByPath.set(operation.path, { status: 'written', sha: blob.sha });
      treeEntries.push({ path: operation.path, mode: '100644', type: 'blob', sha: blob.sha });
      continue;
    }
    if (operation.type === 'reuse') {
      blobByPath.set(operation.path, { status: 'reused', sha: operation.sha });
      treeEntries.push({ path: operation.path, mode: '100644', type: 'blob', sha: operation.sha });
      continue;
    }
    treeEntries.push({ path: operation.path, mode: '100644', type: 'blob', sha: null });
  }

  const files = (): GithubFinalFileResolution[] =>
    operations.map((operation) => {
      if (operation.type === 'write' || operation.type === 'reuse') {
        const resolved = blobByPath.get(operation.path);
        if (!resolved) throw new GithubGitTransportError('github_git_response_invalid');
        return { path: operation.path, ...resolved };
      }
      const resolved = deleteByPath.get(operation.path);
      if (!resolved || resolved.status === 'failure') throw new GithubGitTransportError('github_git_response_invalid');
      return { path: operation.path, status: resolved.status === 'absent' ? 'absent' : 'deleted' };
    });

  if (treeEntries.length === 0) return { status: 'no_changes', treeSha: baseTreeSha, files: files() };

  const treeResponse = await api.post<any>(`/repos/${encodedRepository}/git/trees`, {
    base_tree: baseTreeSha,
    tree: treeEntries,
  });
  const treeSha = requireResponseGitSha(treeResponse?.sha);
  if (treeSha === baseTreeSha) {
    if (deleteResolution.deletes.some((item) => item.status === 'present')) {
      throw new GithubGitTransportError('github_git_response_invalid');
    }
    return { status: 'no_changes', treeSha, files: files() };
  }

  const commitResponse = await api.post<any>(`/repos/${encodedRepository}/git/commits`, {
    message: customMessage ?? `SyncNos: sync ${treeEntries.length} file${treeEntries.length === 1 ? '' : 's'}`,
    tree: treeSha,
    parents: [headSha],
  });
  const commitSha = requireResponseGitSha(commitResponse?.sha);
  let refResponse: any;
  try {
    refResponse = await api.patch<any>(`/repos/${encodedRepository}/git/refs/heads/${encodedBranch}`, {
      sha: commitSha,
      force: false,
    });
  } catch (error) {
    if (isRefBranchRace(error)) throw new GithubGitTransportError('github_git_branch_race');
    throw error;
  }
  const updatedSha = requireResponseGitSha(refResponse?.object?.sha);
  if (updatedSha !== commitSha) throw new GithubGitTransportError('github_git_response_invalid');

  return { status: 'committed', treeSha, commitSha, files: files() };
}

export const GITHUB_BRANCH_RACE_MAX_ATTEMPTS = 3;

async function resolveGithubBranchState(
  repository: string,
  branch: string,
  api: Pick<GithubGitApi, 'get'>,
): Promise<{ headSha: string; treeSha: string }> {
  const encodedRepository = encodeGithubRepositoryPath(repository);
  const encodedBranch = encodeGithubBranchPath(branch);
  const ref = await api.get<any>(`/repos/${encodedRepository}/git/ref/heads/${encodedBranch}`);
  if (ref?.object?.type !== 'commit') throw new GithubGitTransportError('github_git_response_invalid');
  const headSha = requireResponseGitSha(ref?.object?.sha);
  const commit = await api.get<any>(`/repos/${encodedRepository}/git/commits/${encodeURIComponent(headSha)}`);
  const treeSha = requireResponseGitSha(commit?.tree?.sha);
  return { headSha, treeSha };
}

export async function commitGithubStagedOperations(
  input: { repository: string; branch: string; operations: readonly GithubStagedOperation[]; message?: string },
  api: GithubGitApi = githubApiClient,
): Promise<GithubGitTransactionResult> {
  const repository = normalizeGithubRepository(input.repository);
  if (!repository) throw new GithubGitTransportError('github_git_path_invalid');
  const branch = normalizeGithubBranch(input.branch);
  if (!branch) throw new GithubGitTransportError('github_git_branch_invalid');
  const operations = validateGithubStagedOperations(input.operations);

  for (let attempt = 1; attempt <= GITHUB_BRANCH_RACE_MAX_ATTEMPTS; attempt += 1) {
    const state = await resolveGithubBranchState(repository, branch, api);
    try {
      return await commitGithubStagedOperationsOnce(
        { repository, branch, ...state, operations, message: input.message },
        api,
      );
    } catch (error) {
      if (!(error instanceof GithubGitTransportError) || error.code !== 'github_git_branch_race') throw error;
      if (attempt >= GITHUB_BRANCH_RACE_MAX_ATTEMPTS) {
        throw new GithubGitTransportError('github_git_branch_race_exhausted');
      }
    }
  }
  throw new GithubGitTransportError('github_git_branch_race_exhausted');
}
