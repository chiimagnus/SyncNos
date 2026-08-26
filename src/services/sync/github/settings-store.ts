import { storageGet, storageSet } from '@platform/storage/local';

export const GITHUB_STORAGE_KEYS = Object.freeze({
  repository: 'github_repository',
  branch: 'github_branch',
  chatFolder: 'github_chat_folder',
  articleFolder: 'github_article_folder',
  videoFolder: 'github_video_folder',
});

export const GITHUB_DEFAULTS = Object.freeze({
  repository: '',
  branch: '',
  chatFolder: 'SyncNos-AIChats',
  articleFolder: 'SyncNos-WebArticles',
  videoFolder: 'SyncNos-Videos',
});

export type GithubSettingsField = 'repository' | 'branch' | 'chatFolder' | 'articleFolder' | 'videoFolder';

export class GithubSettingsValidationError extends Error {
  readonly code = 'github_settings_invalid' as const;

  constructor(readonly field: GithubSettingsField) {
    super(`github_settings_invalid:${field}`);
    this.name = 'GithubSettingsValidationError';
  }
}

function invalid(field: GithubSettingsField): never {
  throw new GithubSettingsValidationError(field);
}

function requireString(value: unknown, field: GithubSettingsField): string {
  if (typeof value !== 'string') invalid(field);
  return value;
}

function hasControl(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isValidOwner(owner: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner);
}

function isValidRepositoryName(repo: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(repo) && repo !== '.' && repo !== '..';
}

export function normalizeGithubRepository(input: unknown): string {
  const raw = requireString(input, 'repository');
  if (raw === '') return '';
  if (hasControl(raw) || raw.includes('\\')) invalid('repository');

  const parts = raw.split('/');
  if (parts.length !== 2) invalid('repository');
  const owner = parts[0].trim();
  const repo = parts[1].trim();
  if (!owner || !repo || !isValidOwner(owner) || !isValidRepositoryName(repo)) invalid('repository');
  return `${owner}/${repo}`;
}

export function encodeGithubRepositoryPath(repository: unknown): string {
  const normalized = normalizeGithubRepository(repository);
  if (!normalized) invalid('repository');
  const [owner, repo] = normalized.split('/');
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function isUnsafeGitRef(value: string): boolean {
  if (!value || value.startsWith('/') || value.endsWith('/') || value.endsWith('.') || value.startsWith('-'))
    return true;
  if (value === '@' || value.includes('..') || value.includes('//') || value.includes('@{')) return true;
  if (/[\u0000-\u0020\u007f~^:?*\[\\]/.test(value)) return true;
  return value
    .split('/')
    .some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment.startsWith('.') || segment.endsWith('.lock'),
    );
}

export function normalizeGithubBranch(input: unknown): string {
  const raw = requireString(input, 'branch');
  if (raw === '') return '';
  if (raw !== raw.trim() || isUnsafeGitRef(raw)) invalid('branch');
  return raw;
}

export function encodeGithubBranchPath(branch: unknown): string {
  const normalized = normalizeGithubBranch(branch);
  if (!normalized) invalid('branch');
  return normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function normalizeGithubFolderPath(
  input: unknown,
  fallbackFolder: string,
  field: Exclude<GithubSettingsField, 'repository' | 'branch'>,
): string {
  const raw = input == null ? fallbackFolder : requireString(input, field);
  if (!raw || raw !== raw.trim() || raw.startsWith('/') || raw.includes('\\') || hasControl(raw)) invalid(field);

  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) invalid(field);
  if (segments[0]?.toLowerCase() === '.github' && segments[1]?.toLowerCase() === 'workflows') invalid(field);
  return raw;
}

export type GithubSettings = {
  repository: string;
  branch: string;
  chatFolder: string;
  articleFolder: string;
  videoFolder: string;
  defaults: typeof GITHUB_DEFAULTS;
};

export async function getGithubSettings(): Promise<GithubSettings> {
  const values = await storageGet(Object.values(GITHUB_STORAGE_KEYS));
  return {
    repository: normalizeGithubRepository(values[GITHUB_STORAGE_KEYS.repository] ?? GITHUB_DEFAULTS.repository),
    branch: normalizeGithubBranch(values[GITHUB_STORAGE_KEYS.branch] ?? GITHUB_DEFAULTS.branch),
    chatFolder: normalizeGithubFolderPath(
      values[GITHUB_STORAGE_KEYS.chatFolder],
      GITHUB_DEFAULTS.chatFolder,
      'chatFolder',
    ),
    articleFolder: normalizeGithubFolderPath(
      values[GITHUB_STORAGE_KEYS.articleFolder],
      GITHUB_DEFAULTS.articleFolder,
      'articleFolder',
    ),
    videoFolder: normalizeGithubFolderPath(
      values[GITHUB_STORAGE_KEYS.videoFolder],
      GITHUB_DEFAULTS.videoFolder,
      'videoFolder',
    ),
    defaults: GITHUB_DEFAULTS,
  };
}

export async function saveGithubSettings(
  input: Partial<Record<GithubSettingsField, unknown>> = {},
): Promise<GithubSettings> {
  const payload: Record<string, unknown> = {};
  if (input.repository != null) payload[GITHUB_STORAGE_KEYS.repository] = normalizeGithubRepository(input.repository);
  if (input.branch != null) payload[GITHUB_STORAGE_KEYS.branch] = normalizeGithubBranch(input.branch);
  if (input.chatFolder != null) {
    payload[GITHUB_STORAGE_KEYS.chatFolder] = normalizeGithubFolderPath(
      input.chatFolder,
      GITHUB_DEFAULTS.chatFolder,
      'chatFolder',
    );
  }
  if (input.articleFolder != null) {
    payload[GITHUB_STORAGE_KEYS.articleFolder] = normalizeGithubFolderPath(
      input.articleFolder,
      GITHUB_DEFAULTS.articleFolder,
      'articleFolder',
    );
  }
  if (input.videoFolder != null) {
    payload[GITHUB_STORAGE_KEYS.videoFolder] = normalizeGithubFolderPath(
      input.videoFolder,
      GITHUB_DEFAULTS.videoFolder,
      'videoFolder',
    );
  }

  if (Object.keys(payload).length > 0) await storageSet(payload);
  return getGithubSettings();
}
