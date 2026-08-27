import { isSafeGithubCleanupPath } from '@platform/idb/github-cleanup-outbox-record';

const GITHUB_MANAGED_ASSET_FILE_RE = /^[0-9a-f]{64}\.[a-z0-9]{1,10}$/;

export function isGithubManagedPathOwnedByStableId(
  path: string,
  kind: 'markdown' | 'asset',
  stableId: string,
): boolean {
  if (!isSafeGithubCleanupPath(path) || !stableId) return false;
  if (kind === 'markdown') {
    const filename = path.split('/').pop() || '';
    const basename = filename.endsWith('.md') ? filename.slice(0, -3) : '';
    return !!basename && basename.endsWith(`-${stableId}`);
  }

  const segments = path.split('/');
  if (segments.length < 2) return false;
  const filename = segments.at(-1) || '';
  const namespace = segments.at(-2) || '';
  if (!GITHUB_MANAGED_ASSET_FILE_RE.test(filename) || !namespace.endsWith('.assets')) return false;
  const noteBasename = namespace.slice(0, -'.assets'.length);
  return !!noteBasename && noteBasename.endsWith(`-${stableId}`);
}
