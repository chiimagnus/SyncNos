import { stableConversationId10 } from '@services/conversations/domain/file-naming';
import type {
  GithubMarkdownProjection,
  GithubProjectionManagedFile,
} from '@services/sync/github/github-markdown-projection';
import { validateGithubGitPath, type GithubStagedOperation } from '@services/sync/github/github-git-transport';

const GIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;
const ASSET_FILE_RE = /^[0-9a-f]{64}\.[a-z0-9]{1,10}$/;

export type GithubSyncPlannerMode = 'incremental' | 'reconcile';

export type GithubSyncPlannerMapping = {
  githubRemoteKey?: string;
  githubProjectionFingerprint?: string;
  githubManagedFiles?: Record<string, GithubProjectionManagedFile>;
};

export type GithubSyncContinuityDraftFile = {
  kind: 'markdown' | 'asset';
  contentHash: string;
  sha?: string;
};

export type GithubSyncContinuityDraft = {
  githubRemoteKey: string;
  githubProjectionFingerprint: string;
  githubManagedFiles: Record<string, GithubSyncContinuityDraftFile>;
};

export type GithubSyncPlan = {
  status: 'no_changes' | 'changed';
  operations: GithubStagedOperation[];
  nextContinuity: GithubSyncContinuityDraft;
  warnings: string[];
};

function safeManagedFiles(value: unknown): Record<string, GithubProjectionManagedFile> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, GithubProjectionManagedFile> = {};
  for (const [path, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Partial<GithubProjectionManagedFile>;
    if (row.kind !== 'markdown' && row.kind !== 'asset') continue;
    if (typeof row.contentHash !== 'string' || !CONTENT_HASH_RE.test(row.contentHash)) continue;
    if (typeof row.sha !== 'string' || !GIT_SHA_RE.test(row.sha)) continue;
    output[path] = { kind: row.kind, contentHash: row.contentHash, sha: row.sha.toLowerCase() };
  }
  return output;
}

function isSafeGitPath(path: string): boolean {
  try {
    validateGithubGitPath(path);
    return true;
  } catch (_error) {
    return false;
  }
}

function basenameWithoutMd(path: string): string | null {
  const filename = path.split('/').pop() || '';
  return filename.endsWith('.md') ? filename.slice(0, -3) : null;
}

function isOwnedManagedPath(path: string, kind: 'markdown' | 'asset', stableId: string): boolean {
  if (!isSafeGitPath(path) || !stableId) return false;
  if (kind === 'markdown') {
    const basename = basenameWithoutMd(path);
    return !!basename && basename.endsWith(`-${stableId}`);
  }

  const segments = path.split('/');
  if (segments.length < 2) return false;
  const filename = segments.at(-1) || '';
  const namespace = segments.at(-2) || '';
  if (!ASSET_FILE_RE.test(filename) || !namespace.endsWith('.assets')) return false;
  const noteBasename = namespace.slice(0, -'.assets'.length);
  return !!noteBasename && noteBasename.endsWith(`-${stableId}`);
}

function currentFiles(projection: GithubMarkdownProjection): Record<string, GithubSyncContinuityDraftFile> {
  const files: Record<string, GithubSyncContinuityDraftFile> = {
    [projection.markdownPath]: { kind: 'markdown', contentHash: projection.markdownContentHash },
  };
  for (const asset of projection.attachments) {
    files[asset.path] = { kind: 'asset', contentHash: asset.contentHash, sha: asset.sha.toLowerCase() };
  }
  return files;
}

function sameProjectionFiles(
  current: Record<string, GithubSyncContinuityDraftFile>,
  previous: Record<string, GithubProjectionManagedFile>,
): boolean {
  const currentEntries = Object.entries(current);
  const previousEntries = Object.entries(previous);
  if (currentEntries.length !== previousEntries.length) return false;
  return currentEntries.every(([path, row]) => {
    const old = previous[path];
    return !!old && old.kind === row.kind && old.contentHash === row.contentHash;
  });
}

export function planGithubConversationSync(input: {
  conversation: any;
  remoteKey: string;
  projection: GithubMarkdownProjection;
  mapping?: GithubSyncPlannerMapping | null;
  mode: GithubSyncPlannerMode;
}): GithubSyncPlan {
  const remoteKey = String(input.remoteKey || '');
  if (!remoteKey) throw new Error('github_remote_key_required');
  const projection = input.projection;
  const current = currentFiles(projection);
  const previous = safeManagedFiles(input.mapping?.githubManagedFiles);
  const sameTarget = input.mapping?.githubRemoteKey === remoteKey;
  const stableId = stableConversationId10(input.conversation || {});
  const warnings: string[] = [];

  const nextContinuity: GithubSyncContinuityDraft = {
    githubRemoteKey: remoteKey,
    githubProjectionFingerprint: projection.projectionFingerprint,
    githubManagedFiles: current,
  };

  if (
    sameTarget &&
    input.mode === 'incremental' &&
    input.mapping?.githubProjectionFingerprint === projection.projectionFingerprint &&
    sameProjectionFiles(current, previous)
  ) {
    for (const [path, row] of Object.entries(current)) {
      const old = previous[path];
      if (old) row.sha = old.sha;
    }
    return { status: 'no_changes', operations: [], nextContinuity, warnings };
  }

  const operations: GithubStagedOperation[] = [];
  for (const [path, row] of Object.entries(current)) {
    if (!isSafeGitPath(path)) throw new Error('github_projection_path_invalid');
    const old = sameTarget ? previous[path] : undefined;
    const sameContent = !!old && old.kind === row.kind && old.contentHash === row.contentHash;

    if (row.kind === 'markdown') {
      if (sameContent && old) {
        row.sha = old.sha;
        if (input.mode === 'reconcile') operations.push({ type: 'reuse', path, sha: old.sha });
      } else {
        const renamed = sameTarget
          ? Object.entries(previous).find(
              ([oldPath, candidate]) =>
                candidate.kind === 'markdown' &&
                candidate.contentHash === row.contentHash &&
                isOwnedManagedPath(oldPath, 'markdown', stableId),
            )
          : undefined;
        if (renamed) {
          row.sha = renamed[1].sha;
          operations.push({ type: 'reuse', path, sha: renamed[1].sha });
        } else {
          operations.push({ type: 'write', path, content: projection.markdownText });
        }
      }
      continue;
    }

    if (!row.sha || !GIT_SHA_RE.test(row.sha)) throw new Error('github_projection_asset_sha_invalid');
    if (sameContent && input.mode === 'incremental') continue;
    operations.push({ type: 'reuse', path, sha: row.sha });
  }

  if (sameTarget) {
    for (const [path, old] of Object.entries(previous)) {
      if (current[path]) continue;
      if (!isOwnedManagedPath(path, old.kind, stableId)) {
        warnings.push('github_managed_path_ignored');
        continue;
      }
      operations.push({ type: 'delete', path });
    }
  }

  return { status: operations.length ? 'changed' : 'no_changes', operations, nextContinuity, warnings };
}
