import type {
  GithubFinalFileResolution,
  GithubGitTransactionResult,
  GithubStagedOperation,
} from '@services/sync/github/github-git-transport';
import { buildGithubMarkdownProjection } from '@services/sync/github/github-markdown-projection';
import {
  defaultGithubOrchestratorServices,
  type GithubOrchestratorServices,
} from '@services/sync/github/github-orchestrator-services';
import {
  planGithubConversationSync,
  type GithubSyncContinuityDraft,
  type GithubSyncPlannerMode,
} from '@services/sync/github/github-sync-planner';

const GIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;

export type GithubSyncStagedItem = {
  conversationId: number;
  conversationTitle: string;
  status: 'no_changes' | 'staged' | 'failed';
  error: string;
  warnings: string[];
  nextContinuity?: GithubSyncContinuityDraft;
  operations: GithubStagedOperation[];
};

export type GithubSyncStagedRun = {
  target: {
    repository: string;
    branch: string;
    remoteKey: string;
  };
  operations: GithubStagedOperation[];
  items: GithubSyncStagedItem[];
  summary: {
    candidateCount: number;
    noOpCount: number;
    stagedCount: number;
    failedCount: number;
    warningCount: number;
  };
};

export type GithubSyncRunItem = {
  conversationId: number;
  conversationTitle: string;
  status: 'no_changes' | 'synced' | 'mapping_failed' | 'failed';
  error: string;
  warnings: string[];
};

export type GithubSyncRunResult = {
  target: GithubSyncStagedRun['target'];
  transport: {
    status: 'not_needed' | 'committed' | 'no_changes' | 'failed' | 'invalid_resolution';
    commitSha?: string;
  };
  items: GithubSyncRunItem[];
  summary: {
    candidateCount: number;
    noOpCount: number;
    syncedCount: number;
    mappingFailedCount: number;
    failedCount: number;
    warningCount: number;
  };
};

function normalizeIds(input: readonly unknown[] | undefined): number[] {
  const ids = (Array.isArray(input) ? input : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  return [...new Set(ids)];
}

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function operationIdentity(item: GithubSyncStagedItem, operation: GithubStagedOperation): string {
  if (operation.type === 'delete') return 'delete';
  const file = item.nextContinuity?.githubManagedFiles[operation.path];
  if (file?.contentHash) return `${file.kind}:${file.contentHash}`;
  return operation.type === 'reuse' ? `reuse:${operation.sha.toLowerCase()}` : 'write:unknown';
}

function applyCollisionGuard(items: GithubSyncStagedItem[]): GithubStagedOperation[] {
  const byPath = new Map<string, Array<{ item: GithubSyncStagedItem; operation: GithubStagedOperation }>>();
  for (const item of items) {
    if (item.status !== 'staged') continue;
    for (const operation of item.operations) {
      const group = byPath.get(operation.path) ?? [];
      group.push({ item, operation });
      byPath.set(operation.path, group);
    }
  }

  const failedIds = new Set<number>();
  for (const group of byPath.values()) {
    const identities = new Set(group.map(({ item, operation }) => operationIdentity(item, operation)));
    if (identities.size <= 1) continue;
    for (const { item } of group) failedIds.add(item.conversationId);
  }

  if (failedIds.size) {
    for (const item of items) {
      if (!failedIds.has(item.conversationId)) continue;
      item.status = 'failed';
      item.error = 'github_staged_path_collision';
      item.operations = [];
      delete item.nextContinuity;
    }
  }

  const deduped = new Map<string, GithubStagedOperation>();
  for (const item of items) {
    if (item.status !== 'staged') continue;
    for (const operation of item.operations) {
      const key = `${operation.path}\u0000${operationIdentity(item, operation)}`;
      const existing = deduped.get(key);
      if (!existing || (existing.type === 'write' && operation.type === 'reuse')) deduped.set(key, operation);
    }
  }
  return [...deduped.values()];
}

function buildResolutionMap(
  operations: readonly GithubStagedOperation[],
  files: readonly GithubFinalFileResolution[],
): Map<string, GithubFinalFileResolution> | null {
  if (!Array.isArray(files)) return null;
  const expected = new Set(operations.map((operation) => operation.path));
  const resolutions = new Map<string, GithubFinalFileResolution>();
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || !expected.has(file.path) || resolutions.has(file.path)) return null;
    if (file.status === 'written' || file.status === 'reused') {
      if (typeof file.sha !== 'string' || !GIT_SHA_RE.test(file.sha)) return null;
      resolutions.set(file.path, { ...file, sha: file.sha.toLowerCase() });
      continue;
    }
    if (file.status !== 'deleted' && file.status !== 'absent') return null;
    resolutions.set(file.path, file);
  }
  return resolutions.size === expected.size ? resolutions : null;
}

function buildContinuityAck(
  item: GithubSyncStagedItem,
  resolutions: ReadonlyMap<string, GithubFinalFileResolution>,
  syncedAt: number,
): Record<string, unknown> | null {
  const draft = item.nextContinuity;
  if (!draft || !Number.isFinite(syncedAt) || syncedAt < 0) return null;

  for (const operation of item.operations) {
    const resolved = resolutions.get(operation.path);
    if (!resolved) return null;
    if (operation.type === 'delete') {
      if (resolved.status !== 'deleted' && resolved.status !== 'absent') return null;
    } else if (resolved.status !== 'written' && resolved.status !== 'reused') {
      return null;
    }
  }

  const managedFiles: Record<string, { kind: 'markdown' | 'asset'; contentHash: string; sha: string }> = {};
  for (const [path, file] of Object.entries(draft.githubManagedFiles)) {
    if ((file.kind !== 'markdown' && file.kind !== 'asset') || !CONTENT_HASH_RE.test(file.contentHash)) return null;
    const resolved = resolutions.get(path);
    let sha = typeof file.sha === 'string' && GIT_SHA_RE.test(file.sha) ? file.sha.toLowerCase() : '';
    if (resolved) {
      if (resolved.status !== 'written' && resolved.status !== 'reused') return null;
      sha = resolved.sha.toLowerCase();
    }
    if (!sha) return null;
    managedFiles[path] = { kind: file.kind, contentHash: file.contentHash, sha };
  }

  return {
    githubRemoteKey: draft.githubRemoteKey,
    githubManagedFiles: managedFiles,
    githubProjectionFingerprint: draft.githubProjectionFingerprint,
    githubLastSyncedAt: syncedAt,
  };
}

function finalItem(item: GithubSyncStagedItem, status: GithubSyncRunItem['status'], error = ''): GithubSyncRunItem {
  return {
    conversationId: item.conversationId,
    conversationTitle: item.conversationTitle,
    status,
    error,
    warnings: [...item.warnings],
  };
}

function finalSummary(items: readonly GithubSyncRunItem[]) {
  return {
    candidateCount: items.length,
    noOpCount: items.filter((item) => item.status === 'no_changes').length,
    syncedCount: items.filter((item) => item.status === 'synced').length,
    mappingFailedCount: items.filter((item) => item.status === 'mapping_failed').length,
    failedCount: items.filter((item) => item.status === 'failed').length,
    warningCount: items.reduce((count, item) => count + item.warnings.length, 0),
  };
}

function transportFailureCode(error: unknown): string {
  const code = safeString((error as any)?.code);
  return code.startsWith('github_') ? code : 'github_transport_failed';
}

export function createGithubSyncOrchestrator(services: GithubOrchestratorServices = defaultGithubOrchestratorServices) {
  async function stage(input: {
    conversationIds?: readonly unknown[];
    mode?: GithubSyncPlannerMode;
  }): Promise<GithubSyncStagedRun> {
    const ids = normalizeIds(input.conversationIds);
    const mode: GithubSyncPlannerMode = input.mode === 'reconcile' ? 'reconcile' : 'incremental';
    const settings = await services.getSettings();
    const preflight = await services.preflight({ repository: settings.repository, branch: settings.branch });
    const items: GithubSyncStagedItem[] = [];

    for (const conversationId of ids) {
      try {
        const row = await services.storage.getSyncMappingByConversation(conversationId);
        if (!row?.conversation) throw new Error('conversation not found');
        const conversation = row.conversation;
        const messages = await services.storage.getMessagesByConversationId(conversationId);
        let comments: any[] = [];
        if (safeString(conversation.sourceType) === 'article') {
          const canonicalUrl = safeString(conversation.url);
          if (canonicalUrl) {
            await services.storage.attachOrphanArticleCommentsToConversation(canonicalUrl, conversationId);
          }
          comments = await services.storage.getArticleCommentsByConversationId(conversationId);
        }

        const projection = await buildGithubMarkdownProjection({
          conversation,
          messages,
          comments,
          folders: settings,
          remoteKey: preflight.remoteKey,
          continuity: row.mapping || undefined,
          imageLoader: services.loadImage,
          blobUploader: ({ content }) => services.createBlob({ repository: preflight.repository, content }),
        });
        const plan = planGithubConversationSync({
          conversation,
          remoteKey: preflight.remoteKey,
          projection,
          mapping: row.mapping || undefined,
          mode,
        });
        items.push({
          conversationId,
          conversationTitle: safeString(conversation.title),
          status: plan.status === 'no_changes' ? 'no_changes' : 'staged',
          error: '',
          warnings: [...projection.warnings.map((warning) => warning.code), ...plan.warnings],
          nextContinuity: plan.nextContinuity,
          operations: plan.operations,
        });
      } catch (error) {
        items.push({
          conversationId,
          conversationTitle: '',
          status: 'failed',
          error: safeString((error as any)?.code || (error as any)?.message || 'github_local_stage_failed'),
          warnings: [],
          operations: [],
        });
      }
    }

    const operations = applyCollisionGuard(items);
    const summary = {
      candidateCount: ids.length,
      noOpCount: items.filter((item) => item.status === 'no_changes').length,
      stagedCount: items.filter((item) => item.status === 'staged').length,
      failedCount: items.filter((item) => item.status === 'failed').length,
      warningCount: items.reduce((count, item) => count + item.warnings.length, 0),
    };
    return {
      target: { repository: preflight.repository, branch: preflight.branch, remoteKey: preflight.remoteKey },
      operations,
      items,
      summary,
    };
  }

  async function sync(input: {
    conversationIds?: readonly unknown[];
    mode?: GithubSyncPlannerMode;
  }): Promise<GithubSyncRunResult> {
    const staged = await stage(input);
    const changed = staged.items.filter((item) => item.status === 'staged');
    if (!staged.operations.length) {
      const items = staged.items.map((item) =>
        item.status === 'no_changes' ? finalItem(item, 'no_changes') : finalItem(item, 'failed', item.error),
      );
      return { target: staged.target, transport: { status: 'not_needed' }, items, summary: finalSummary(items) };
    }

    let transport: GithubGitTransactionResult;
    try {
      transport = await services.commit({
        repository: staged.target.repository,
        branch: staged.target.branch,
        operations: staged.operations,
        message: `SyncNos GitHub sync (${changed.length} items)`,
      });
    } catch (error) {
      const code = transportFailureCode(error);
      const items = staged.items.map((item) => {
        if (item.status === 'no_changes') return finalItem(item, 'no_changes');
        if (item.status === 'staged') return finalItem(item, 'failed', code);
        return finalItem(item, 'failed', item.error);
      });
      return { target: staged.target, transport: { status: 'failed' }, items, summary: finalSummary(items) };
    }

    if (transport.status !== 'committed' && transport.status !== 'no_changes') {
      const items = staged.items.map((item) =>
        item.status === 'staged'
          ? finalItem(item, 'failed', 'github_transport_resolution_incomplete')
          : item.status === 'no_changes'
            ? finalItem(item, 'no_changes')
            : finalItem(item, 'failed', item.error),
      );
      return {
        target: staged.target,
        transport: { status: 'invalid_resolution' },
        items,
        summary: finalSummary(items),
      };
    }

    const resolutions = buildResolutionMap(staged.operations, transport.files);
    if (!resolutions) {
      const items = staged.items.map((item) =>
        item.status === 'staged'
          ? finalItem(item, 'failed', 'github_transport_resolution_incomplete')
          : item.status === 'no_changes'
            ? finalItem(item, 'no_changes')
            : finalItem(item, 'failed', item.error),
      );
      return {
        target: staged.target,
        transport: {
          status: 'invalid_resolution',
          ...(transport.status === 'committed' ? { commitSha: transport.commitSha } : {}),
        },
        items,
        summary: finalSummary(items),
      };
    }

    const syncedAt = services.now();
    const items: GithubSyncRunItem[] = [];
    for (const item of staged.items) {
      if (item.status === 'no_changes') {
        items.push(finalItem(item, 'no_changes'));
        continue;
      }
      if (item.status === 'failed') {
        items.push(finalItem(item, 'failed', item.error));
        continue;
      }

      const patch = buildContinuityAck(item, resolutions, syncedAt);
      if (!patch) {
        items.push(finalItem(item, 'failed', 'github_transport_resolution_incomplete'));
        continue;
      }
      try {
        await services.storage.patchSyncMapping(item.conversationId, patch);
        items.push(finalItem(item, 'synced'));
      } catch (_error) {
        const row = finalItem(item, 'mapping_failed', 'github_mapping_patch_failed');
        row.warnings.push('github_mapping_patch_failed');
        items.push(row);
      }
    }

    return {
      target: staged.target,
      transport: {
        status: transport.status,
        ...(transport.status === 'committed' ? { commitSha: transport.commitSha } : {}),
      },
      items,
      summary: finalSummary(items),
    };
  }

  return { stage, sync };
}

export const githubSyncOrchestrator = createGithubSyncOrchestrator();
