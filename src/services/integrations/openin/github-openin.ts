import { readGithubContinuity } from '@platform/idb/sync-mapping-record';
import type { Conversation } from '@services/conversations/domain/models';
import { isGithubManagedPathOwnedByConversation } from '@services/sync/github/github-managed-path-ownership';
import {
  encodeGithubBranchPath,
  encodeGithubRepositoryPath,
  normalizeGithubBranch,
  normalizeGithubRepository,
} from '@services/sync/github/settings-store';

const GITHUB_REMOTE_KEY_PREFIX = 'github.com/';

function parseGithubRemoteKey(remoteKey: unknown): { repository: string; branch: string } | null {
  if (typeof remoteKey !== 'string' || !remoteKey.startsWith(GITHUB_REMOTE_KEY_PREFIX)) return null;
  const at = remoteKey.indexOf('@', GITHUB_REMOTE_KEY_PREFIX.length);
  if (at <= GITHUB_REMOTE_KEY_PREFIX.length || at >= remoteKey.length - 1) return null;

  try {
    const repository = normalizeGithubRepository(remoteKey.slice(GITHUB_REMOTE_KEY_PREFIX.length, at));
    const branch = normalizeGithubBranch(remoteKey.slice(at + 1));
    return repository && branch ? { repository, branch } : null;
  } catch (_error) {
    return null;
  }
}

function encodeGithubFilePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function buildGithubSyncedMarkdownUrl(input: {
  conversation: Conversation | null | undefined;
  mapping: unknown;
}): string {
  if (!input.conversation) return '';

  const continuity = readGithubContinuity(input.mapping);
  if (typeof continuity.githubLastSyncedAt !== 'number') return '';

  const remote = parseGithubRemoteKey(continuity.githubRemoteKey);
  const files = continuity.githubManagedFiles;
  if (!remote || !files || typeof files !== 'object' || Array.isArray(files)) return '';

  const markdownPaths = Object.entries(files)
    .filter(([, file]) => (file as any)?.kind === 'markdown')
    .map(([path]) => path)
    .filter((path) => isGithubManagedPathOwnedByConversation(path, 'markdown', input.conversation));
  if (markdownPaths.length !== 1) return '';

  try {
    const repository = encodeGithubRepositoryPath(remote.repository);
    const branch = encodeGithubBranchPath(remote.branch);
    const path = encodeGithubFilePath(markdownPaths[0]!);
    return `https://github.com/${repository}/blob/${branch}/${path}`;
  } catch (_error) {
    return '';
  }
}
