import { GITHUB_APP_CONFIG } from '@services/sync/github/github-app-config';
import { GithubApiError, githubApiClient } from '@services/sync/github/github-api-client';
import {
  encodeGithubBranchPath,
  encodeGithubRepositoryPath,
  getGithubSettings,
  normalizeGithubBranch,
  normalizeGithubRepository,
} from '@services/sync/github/settings-store';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const GIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export type GithubRepositoryErrorCode =
  | 'github_repository_not_configured'
  | 'github_app_not_installed'
  | 'github_no_accessible_repositories'
  | 'github_repository_not_accessible'
  | 'github_app_contents_write_required'
  | 'github_repository_write_required'
  | 'github_repository_uninitialized'
  | 'github_branch_not_found'
  | 'github_default_branch_unavailable'
  | 'github_repository_response_invalid';

export class GithubRepositoryError extends Error {
  constructor(readonly code: GithubRepositoryErrorCode) {
    super(code);
    this.name = 'GithubRepositoryError';
  }
}

type GithubApiReader = {
  get<T>(path: string): Promise<T>;
};

export type GithubSafeAccount = {
  login: string;
  avatarUrl: string;
  url: string;
};

export type GithubUserRepositoryPermissions = {
  admin: boolean;
  maintain: boolean;
  push: boolean;
  pull: boolean;
  triage: boolean;
};

export type GithubAccessibleRepository = {
  owner: string;
  repo: string;
  fullName: string;
  private: boolean;
  installationId: number;
  userPermissions: GithubUserRepositoryPermissions;
  installationContentsPermission: 'write' | 'read' | 'unknown';
  contentWriteCapable: boolean;
};

export type GithubRepositoryDiscovery = {
  status: 'ready' | 'github_app_not_installed' | 'github_no_accessible_repositories';
  account: GithubSafeAccount | null;
  repositories: GithubAccessibleRepository[];
  installUrl: string;
  appUrl: string;
};

export type GithubRepositoryPreflight = {
  repository: string;
  branch: string;
  remoteKey: string;
  installationId: number;
  headSha: string;
  treeSha: string;
};

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeInstallationId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeUserPermissions(value: unknown): GithubUserRepositoryPermissions {
  const raw = value && typeof value === 'object' ? (value as any) : {};
  return {
    admin: raw.admin === true,
    maintain: raw.maintain === true,
    push: raw.push === true,
    pull: raw.pull === true,
    triage: raw.triage === true,
  };
}

function userCanWrite(permissions: GithubUserRepositoryPermissions): boolean {
  return permissions.admin || permissions.maintain || permissions.push;
}

function normalizeContentsPermission(value: unknown): 'write' | 'read' | 'unknown' {
  return value === 'write' ? 'write' : value === 'read' ? 'read' : 'unknown';
}

function normalizeRepositoryRow(
  raw: any,
  installationId: number,
  installationContentsPermission: 'write' | 'read' | 'unknown',
): GithubAccessibleRepository | null {
  const owner = safeString(raw?.owner?.login);
  const repo = safeString(raw?.name);
  let fullName: string;
  try {
    fullName = normalizeGithubRepository(`${owner}/${repo}`);
  } catch (_error) {
    return null;
  }
  if (!fullName) return null;

  const userPermissions = normalizeUserPermissions(raw?.permissions);
  return {
    owner: fullName.split('/')[0],
    repo: fullName.split('/')[1],
    fullName,
    private: raw?.private === true,
    installationId,
    userPermissions,
    installationContentsPermission,
    contentWriteCapable: installationContentsPermission === 'write' && userCanWrite(userPermissions),
  };
}

function preferRepository(
  current: GithubAccessibleRepository | undefined,
  candidate: GithubAccessibleRepository,
): GithubAccessibleRepository {
  if (!current) return candidate;
  if (candidate.contentWriteCapable !== current.contentWriteCapable) {
    return candidate.contentWriteCapable ? candidate : current;
  }
  if (candidate.installationContentsPermission !== current.installationContentsPermission) {
    if (candidate.installationContentsPermission === 'write') return candidate;
    if (current.installationContentsPermission === 'write') return current;
  }
  return candidate.installationId < current.installationId ? candidate : current;
}

async function listPaged<T>(
  api: GithubApiReader,
  pathForPage: (page: number) => string,
  select: (response: any) => T[] | null,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await api.get<any>(pathForPage(page));
    const rows = select(response);
    if (!rows) throw new GithubRepositoryError('github_repository_response_invalid');
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
  throw new GithubRepositoryError('github_repository_response_invalid');
}

export async function discoverGithubRepositories(
  api: GithubApiReader = githubApiClient,
): Promise<GithubRepositoryDiscovery> {
  const user = await api.get<any>('/user');
  const login = safeString(user?.login);
  const account: GithubSafeAccount | null = login
    ? { login, avatarUrl: safeString(user?.avatar_url), url: safeString(user?.html_url) }
    : null;

  const installations = await listPaged<any>(
    api,
    (page) => `/user/installations?per_page=${PAGE_SIZE}&page=${page}`,
    (response) => (Array.isArray(response?.installations) ? response.installations : null),
  );
  const relevantInstallations = installations
    .map((raw) => {
      const id = safeInstallationId(raw?.id);
      if (!id) return null;
      const appSlug = safeString(raw?.app_slug);
      if (appSlug !== GITHUB_APP_CONFIG.appSlug) return null;
      return {
        id,
        contents: normalizeContentsPermission(raw?.permissions?.contents),
      };
    })
    .filter((value): value is { id: number; contents: 'write' | 'read' | 'unknown' } => value != null);

  if (relevantInstallations.length === 0) {
    return {
      status: 'github_app_not_installed',
      account,
      repositories: [],
      installUrl: GITHUB_APP_CONFIG.installUrl,
      appUrl: GITHUB_APP_CONFIG.appUrl,
    };
  }

  const deduped = new Map<string, GithubAccessibleRepository>();
  for (const installation of relevantInstallations) {
    const repositories = await listPaged<any>(
      api,
      (page) => `/user/installations/${installation.id}/repositories?per_page=${PAGE_SIZE}&page=${page}`,
      (response) => (Array.isArray(response?.repositories) ? response.repositories : null),
    );
    for (const raw of repositories) {
      const candidate = normalizeRepositoryRow(raw, installation.id, installation.contents);
      if (!candidate) continue;
      const key = candidate.fullName.toLowerCase();
      deduped.set(key, preferRepository(deduped.get(key), candidate));
    }
  }

  const repositories = Array.from(deduped.values()).sort(
    (a, b) =>
      a.fullName.localeCompare(b.fullName, 'en', { sensitivity: 'base' }) || a.installationId - b.installationId,
  );
  return {
    status: repositories.length ? 'ready' : 'github_no_accessible_repositories',
    account,
    repositories,
    installUrl: GITHUB_APP_CONFIG.installUrl,
    appUrl: GITHUB_APP_CONFIG.appUrl,
  };
}

function isApiStatus(error: unknown, status: number): boolean {
  return error instanceof GithubApiError && error.status === status;
}

function requireGitSha(value: unknown): string {
  const sha = safeString(value);
  if (!GIT_SHA_RE.test(sha)) throw new GithubRepositoryError('github_repository_response_invalid');
  return sha.toLowerCase();
}

export async function preflightGithubRepository(
  input: { repository: string; branch: string },
  api: GithubApiReader = githubApiClient,
): Promise<GithubRepositoryPreflight> {
  const repository = normalizeGithubRepository(input.repository);
  if (!repository) throw new GithubRepositoryError('github_repository_not_configured');
  const explicitBranch = normalizeGithubBranch(input.branch);

  const discovery = await discoverGithubRepositories(api);
  if (discovery.status === 'github_app_not_installed') throw new GithubRepositoryError('github_app_not_installed');
  if (discovery.status === 'github_no_accessible_repositories') {
    throw new GithubRepositoryError('github_no_accessible_repositories');
  }

  const selected = discovery.repositories.find((item) => item.fullName.toLowerCase() === repository.toLowerCase());
  if (!selected) throw new GithubRepositoryError('github_repository_not_accessible');
  if (selected.installationContentsPermission !== 'write') {
    throw new GithubRepositoryError('github_app_contents_write_required');
  }
  if (!userCanWrite(selected.userPermissions)) throw new GithubRepositoryError('github_repository_write_required');

  const encodedRepository = encodeGithubRepositoryPath(repository);
  let metadata: any;
  try {
    metadata = await api.get<any>(`/repos/${encodedRepository}`);
  } catch (error) {
    if (isApiStatus(error, 404)) throw new GithubRepositoryError('github_repository_not_accessible');
    throw error;
  }

  const defaultBranchRaw = safeString(metadata?.default_branch);
  if (!defaultBranchRaw) throw new GithubRepositoryError('github_repository_uninitialized');

  let branch: string;
  try {
    branch = explicitBranch || normalizeGithubBranch(defaultBranchRaw);
  } catch (_error) {
    throw new GithubRepositoryError('github_default_branch_unavailable');
  }
  if (!branch) throw new GithubRepositoryError('github_default_branch_unavailable');

  let ref: any;
  try {
    ref = await api.get<any>(`/repos/${encodedRepository}/git/ref/heads/${encodeGithubBranchPath(branch)}`);
  } catch (error) {
    if (isApiStatus(error, 409)) throw new GithubRepositoryError('github_repository_uninitialized');
    if (isApiStatus(error, 404)) {
      throw new GithubRepositoryError(explicitBranch ? 'github_branch_not_found' : 'github_default_branch_unavailable');
    }
    throw error;
  }
  const headSha = requireGitSha(ref?.object?.sha);
  if (safeString(ref?.object?.type) !== 'commit') {
    throw new GithubRepositoryError('github_repository_response_invalid');
  }

  const commit = await api.get<any>(`/repos/${encodedRepository}/git/commits/${encodeURIComponent(headSha)}`);
  const treeSha = requireGitSha(commit?.tree?.sha);
  return {
    repository,
    branch,
    remoteKey: `github.com/${repository}@${branch}`,
    installationId: selected.installationId,
    headSha,
    treeSha,
  };
}

export async function preflightConfiguredGithubRepository(
  api: GithubApiReader = githubApiClient,
): Promise<GithubRepositoryPreflight> {
  const settings = await getGithubSettings();
  return preflightGithubRepository({ repository: settings.repository, branch: settings.branch }, api);
}
