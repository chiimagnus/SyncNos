import type { GithubCleanupOutboxRecord } from '@platform/idb/github-cleanup-outbox-record';
import { readGithubContinuity } from '@platform/idb/sync-mapping-record';
import { GITHUB_CLEANUP_OUTBOX_BATCH_LIMIT } from '@services/sync/github/github-cleanup-outbox-store';
import type {
  GithubFinalFileResolution,
  GithubGitTransactionResult,
  GithubStagedOperation,
} from '@services/sync/github/github-git-transport';
import { isGithubManagedPathOwnedByConversation } from '@services/sync/github/github-managed-path-ownership';
import { buildGithubMarkdownProjection } from '@services/sync/github/github-markdown-projection';
import {
  defaultGithubOrchestratorServices,
  type GithubOrchestratorServices,
} from '@services/sync/github/github-orchestrator-services';
import type { GithubRepositoryPreflight } from '@services/sync/github/github-repository-service';
import {
  planGithubConversationSync,
  type GithubSyncContinuityDraft,
  type GithubSyncPlannerMode,
} from '@services/sync/github/github-sync-planner';
import type { GithubSettings } from '@services/sync/github/settings-store';
import { createSyncJobLifecycle, type SyncJobLifecycle } from '@services/sync/sync-job-lifecycle';
import { createSyncRunOwnership } from '@services/sync/sync-run-ownership';
import { normalizeSyncConversationIds } from '@services/sync/sync-conversation-ids';
import type { SyncJobSnapshot, SyncPerConversationResult, SyncWarning } from '@services/sync/models';

const GIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;

type GithubSyncStagedItem = {
  conversationId: number;
  conversationTitle: string;
  status: 'no_changes' | 'staged' | 'failed';
  error: string;
  warnings: string[];
  nextContinuity?: GithubSyncContinuityDraft;
  operations: GithubStagedOperation[];
};

type GithubSyncStagedRun = {
  target: {
    repository: string;
    branch: string;
    remoteKey: string;
  };
  operations: GithubStagedOperation[];
  items: GithubSyncStagedItem[];
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
  cleanupHasMoreDue: boolean;
  nextCleanupDueAt: number | null;
  deferredReplacementConversationIds: number[];
  cleanupWarnings: string[];
};

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

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function successfulSameTargetOwnedPaths(mapping: any, remoteKey: string, conversation: any): Set<string> | null {
  const continuity = readGithubContinuity(mapping);
  if (continuity.githubRemoteKey !== remoteKey || typeof continuity.githubLastSyncedAt !== 'number') return null;
  const files = continuity.githubManagedFiles;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
  const ownedEntries = Object.entries(files).filter(([path, file]) =>
    isGithubManagedPathOwnedByConversation(path, file.kind, conversation),
  );
  if (!ownedEntries.some(([, file]) => file.kind === 'markdown')) return null;
  return new Set(ownedEntries.map(([path]) => path));
}

function mergeCleanupDeletes(
  currentOperations: readonly GithubStagedOperation[],
  cleanupPaths: ReadonlySet<string>,
): GithubStagedOperation[] {
  const operations = [...currentOperations];
  const currentByPath = new Map(currentOperations.map((operation) => [operation.path, operation]));
  for (const path of [...cleanupPaths].sort()) {
    if (currentByPath.has(path)) continue;
    operations.push({ type: 'delete', path });
  }
  return operations;
}

function buildJobPersistenceError(): Error {
  return Object.assign(new Error('github sync job persistence failed'), { code: 'github_sync_job_persist_failed' });
}

function toJobWarnings(codes: readonly string[]): SyncWarning[] {
  return [...new Set(codes.map(safeString).filter(Boolean))].map((code) => ({ code, message: code }));
}

function toJobRows(items: readonly GithubSyncRunItem[], at: number): SyncPerConversationResult[] {
  return items.map((item) => ({
    conversationId: item.conversationId,
    conversationTitle: item.conversationTitle || undefined,
    ok: item.status === 'synced' || item.status === 'no_changes',
    mode: item.status,
    appended: 0,
    error: item.error,
    warnings: toJobWarnings(item.warnings),
    at,
  }));
}

export function createGithubSyncOrchestrator(services: GithubOrchestratorServices = defaultGithubOrchestratorServices) {
  const ownership = createSyncRunOwnership();

  async function stageResolved(
    ids: readonly number[],
    mode: GithubSyncPlannerMode,
    preflight: GithubRepositoryPreflight,
    lifecycle: SyncJobLifecycle,
  ): Promise<GithubSyncStagedRun> {
    const items: GithubSyncStagedItem[] = [];

    for (const conversationId of ids) {
      try {
        const row = await services.storage.getSyncMappingByConversation(conversationId);
        if (!row?.conversation) throw new Error('conversation not found');
        const conversation = row.conversation;
        const conversationTitle = safeString(conversation.title);
        await lifecycle.setItem(conversationId, { conversationTitle, currentStage: 'staging_projection' });
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
          remoteKey: preflight.remoteKey,
          continuity: row.mapping || undefined,
          imageBatchLoader: services.loadImages,
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
          conversationTitle,
          status: plan.status === 'no_changes' ? 'no_changes' : 'staged',
          error: '',
          warnings: [...projection.warnings.map((warning) => warning.code), ...plan.warnings],
          nextContinuity: plan.nextContinuity,
          operations: plan.operations,
        });
      } catch (error) {
        items.push({
          conversationId,
          conversationTitle: lifecycle.titleFor(conversationId),
          status: 'failed',
          error: safeString((error as any)?.code || (error as any)?.message || 'github_local_stage_failed'),
          warnings: [],
          operations: [],
        });
      } finally {
        await lifecycle.finishItem(conversationId, { persist: false });
      }
    }

    return {
      target: { repository: preflight.repository, branch: preflight.branch, remoteKey: preflight.remoteKey },
      operations: applyCollisionGuard(items),
      items,
    };
  }

  async function getSyncStatus() {
    return { provider: 'github' as const, job: await services.jobStore.getJob() };
  }

  function clearSyncStatus() {
    return ownership.runExclusiveMutation(async () => {
      if (!(await services.jobStore.setJob(null))) throw buildJobPersistenceError();
      return { provider: 'github' as const, job: null };
    });
  }

  function runExclusiveMaintenance<T>(mutation: () => Promise<T>): Promise<T> {
    return ownership.runExclusiveMutation(mutation);
  }

  function reconcileStartupSyncJob() {
    return ownership.runExclusiveMutation(() => services.jobStore.abortRunningJob());
  }

  async function runSync(input: {
    conversationIds?: readonly unknown[];
    mode?: GithubSyncPlannerMode;
    instanceId?: string;
  }): Promise<GithubSyncRunResult> {
    const ids = normalizeSyncConversationIds(input.conversationIds);
    const mode: GithubSyncPlannerMode = input.mode === 'reconcile' ? 'reconcile' : 'incremental';
    const instanceId = safeString(input.instanceId);
    const runNow = services.now();
    const cleanupWarnings: string[] = [];
    const deferredReplacementIds = new Set<number>();
    let cleanupHasMoreDue = false;
    let dueRows: GithubCleanupOutboxRecord[] = [];
    let lifecycle: SyncJobLifecycle | null = null;
    let jobPersistenceWarning = false;

    const claimJob = async (currentStage: string): Promise<SyncJobLifecycle> => {
      const startedAt = services.now();
      const candidate: SyncJobSnapshot = {
        id: `${startedAt}_${Math.random().toString(16).slice(2)}`,
        provider: 'github',
        instanceId,
        status: 'running',
        startedAt,
        updatedAt: startedAt,
        finishedAt: null,
        totalCount: ids.length,
        conversationIds: [],
        currentStage,
        okCount: 0,
        failCount: 0,
        perConversation: [],
      };
      if (!(await services.jobStore.setJob(candidate))) throw buildJobPersistenceError();

      return createSyncJobLifecycle({
        initialJob: candidate,
        configuredConversationIds: ids,
        persist: async (job) => {
          const persisted = await services.jobStore.setJob(job);
          if (!persisted) jobPersistenceWarning = true;
          return persisted;
        },
        now: services.now,
      });
    };

    try {
      let settings: GithubSettings;
      let preflight: GithubRepositoryPreflight;
      let staged: GithubSyncStagedRun;

      if (ids.length) {
        lifecycle = await claimJob('preparing_queue');
        await lifecycle.setRunStage('preflight');
        settings = await services.getSettings();
        preflight = await services.preflight({ repository: settings.repository, branch: settings.branch });
        await lifecycle.setRunStage('staging_projection');
        staged = await stageResolved(ids, mode, preflight, lifecycle);
        await lifecycle.setRunStage('cleaning_remote_files');
      } else {
        settings = await services.getSettings();
        preflight = await services.preflight({ repository: settings.repository, branch: settings.branch });
        staged = {
          target: { repository: preflight.repository, branch: preflight.branch, remoteKey: preflight.remoteKey },
          operations: [],
          items: [],
        };
      }

      try {
        const batch = await services.listDueCleanupRows(
          staged.target.remoteKey,
          runNow,
          GITHUB_CLEANUP_OUTBOX_BATCH_LIMIT,
        );
        dueRows = batch.rows;
        cleanupHasMoreDue = batch.hasMoreDue;
      } catch (_error) {
        cleanupWarnings.push('github_cleanup_list_failed');
      }

      if (!ids.length && dueRows.length) lifecycle = await claimJob('cleaning_remote_files');

      const stagedByConversationId = new Map(staged.items.map((item) => [item.conversationId, item]));
      const replacementChecks = new Map<
        number,
        { safe: boolean; dependsOnCurrentTransport: boolean; protectedPaths: Set<string> }
      >();
      const resolveReplacement = async (conversationId: number) => {
        const cached = replacementChecks.get(conversationId);
        if (cached) return cached;

        const current = stagedByConversationId.get(conversationId);
        if (current) {
          const safe = current.status === 'staged' || current.status === 'no_changes';
          const result = {
            safe,
            dependsOnCurrentTransport: current.status === 'staged',
            protectedPaths: safe
              ? new Set(Object.keys(current.nextContinuity?.githubManagedFiles ?? {}))
              : new Set<string>(),
          };
          replacementChecks.set(conversationId, result);
          return result;
        }

        try {
          const row = await services.storage.getSyncMappingByConversation(conversationId);
          if (!row?.conversation) {
            const result = { safe: true, dependsOnCurrentTransport: false, protectedPaths: new Set<string>() };
            replacementChecks.set(conversationId, result);
            return result;
          }
          const protectedPaths = successfulSameTargetOwnedPaths(row.mapping, staged.target.remoteKey, row.conversation);
          const result = {
            safe: protectedPaths != null,
            dependsOnCurrentTransport: false,
            protectedPaths: protectedPaths ?? new Set<string>(),
          };
          replacementChecks.set(conversationId, result);
          return result;
        } catch (_error) {
          cleanupWarnings.push('github_cleanup_replacement_check_failed');
          const result = { safe: false, dependsOnCurrentTransport: false, protectedPaths: new Set<string>() };
          replacementChecks.set(conversationId, result);
          return result;
        }
      };

      const cleanupDeletePaths = new Set<string>();
      const ackAfterTransportIds: number[] = [];
      const ackSupersededIds: number[] = [];
      const deferIds: number[] = [];
      for (const row of dueRows) {
        const rowId = positiveId(row.id);
        if (!rowId) {
          cleanupWarnings.push('github_cleanup_row_id_invalid');
          continue;
        }
        if (row.reason === 'delete') {
          ackAfterTransportIds.push(rowId);
          row.paths.forEach((path) => cleanupDeletePaths.add(path));
          continue;
        }

        const replacementConversationId = positiveId(row.replacementConversationId);
        if (!replacementConversationId) {
          cleanupWarnings.push('github_cleanup_replacement_id_invalid');
          continue;
        }
        const replacement = await resolveReplacement(replacementConversationId);
        if (!replacement.safe) {
          deferIds.push(rowId);
          deferredReplacementIds.add(replacementConversationId);
          continue;
        }

        const remainingPaths = row.paths.filter((path) => !replacement.protectedPaths.has(path));
        remainingPaths.forEach((path) => cleanupDeletePaths.add(path));
        if (remainingPaths.length || replacement.dependsOnCurrentTransport) ackAfterTransportIds.push(rowId);
        else ackSupersededIds.push(rowId);
      }

      const replacementDeferMs =
        Number.isFinite(services.replacementDeferMs) && services.replacementDeferMs > 0
          ? Math.floor(services.replacementDeferMs)
          : 1;
      if (deferIds.length) {
        try {
          await services.deferCleanupRows(deferIds, runNow + replacementDeferMs);
        } catch (_error) {
          cleanupWarnings.push('github_cleanup_defer_failed');
        }
      }
      if (ackSupersededIds.length) {
        try {
          await services.ackCleanupRows(ackSupersededIds);
        } catch (_error) {
          cleanupWarnings.push('github_cleanup_ack_failed');
        }
      }

      type ResultWithoutCleanup = Omit<
        GithubSyncRunResult,
        'cleanupHasMoreDue' | 'nextCleanupDueAt' | 'deferredReplacementConversationIds' | 'cleanupWarnings'
      >;
      const finalizeCleanup = async (result: ResultWithoutCleanup): Promise<GithubSyncRunResult> => {
        let nextCleanupDueAt: number | null = null;
        try {
          nextCleanupDueAt = await services.getNextCleanupDueAt(staged.target.remoteKey);
        } catch (_error) {
          cleanupWarnings.push('github_cleanup_next_due_failed');
        }

        const finalResult: GithubSyncRunResult = {
          ...result,
          cleanupHasMoreDue,
          nextCleanupDueAt,
          deferredReplacementConversationIds: [...deferredReplacementIds].slice(0, GITHUB_CLEANUP_OUTBOX_BATCH_LIMIT),
          cleanupWarnings: [...new Set(cleanupWarnings)],
        };
        if (lifecycle) {
          const perConversation = toJobRows(finalResult.items, services.now());
          await lifecycle.finish(perConversation, { currentStage: 'done' });
        }
        if (jobPersistenceWarning) {
          finalResult.cleanupWarnings = [
            ...new Set([...finalResult.cleanupWarnings, 'github_sync_job_persist_failed']),
          ];
        }
        return finalResult;
      };

      const operations = mergeCleanupDeletes(staged.operations, cleanupDeletePaths);
      if (!operations.length) {
        const items = staged.items.map((item) =>
          item.status === 'no_changes' ? finalItem(item, 'no_changes') : finalItem(item, 'failed', item.error),
        );
        return await finalizeCleanup({
          target: staged.target,
          transport: { status: 'not_needed' },
          items,
          summary: finalSummary(items),
        });
      }

      let transport: GithubGitTransactionResult;
      try {
        await lifecycle?.setRunStage('committing_tree');
        transport = await services.commit({
          repository: staged.target.repository,
          branch: staged.target.branch,
          operations,
        });
      } catch (error) {
        const code = transportFailureCode(error);
        const items = staged.items.map((item) => {
          if (item.status === 'no_changes') return finalItem(item, 'no_changes');
          if (item.status === 'staged') return finalItem(item, 'failed', code);
          return finalItem(item, 'failed', item.error);
        });
        return await finalizeCleanup({
          target: staged.target,
          transport: { status: 'failed' },
          items,
          summary: finalSummary(items),
        });
      }

      if (transport.status !== 'committed' && transport.status !== 'no_changes') {
        const items = staged.items.map((item) =>
          item.status === 'staged'
            ? finalItem(item, 'failed', 'github_transport_resolution_incomplete')
            : item.status === 'no_changes'
              ? finalItem(item, 'no_changes')
              : finalItem(item, 'failed', item.error),
        );
        return await finalizeCleanup({
          target: staged.target,
          transport: { status: 'invalid_resolution' },
          items,
          summary: finalSummary(items),
        });
      }

      const resolutions = buildResolutionMap(operations, transport.files);
      if (!resolutions) {
        const items = staged.items.map((item) =>
          item.status === 'staged'
            ? finalItem(item, 'failed', 'github_transport_resolution_incomplete')
            : item.status === 'no_changes'
              ? finalItem(item, 'no_changes')
              : finalItem(item, 'failed', item.error),
        );
        return await finalizeCleanup({
          target: staged.target,
          transport: {
            status: 'invalid_resolution',
            ...(transport.status === 'committed' ? { commitSha: transport.commitSha } : {}),
          },
          items,
          summary: finalSummary(items),
        });
      }

      await lifecycle?.setRunStage('updating_mappings');
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

        const patch = buildContinuityAck(item, resolutions, runNow);
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

      if (ackAfterTransportIds.length) {
        try {
          await services.ackCleanupRows(ackAfterTransportIds);
        } catch (_error) {
          cleanupWarnings.push('github_cleanup_ack_failed');
        }
      }

      return await finalizeCleanup({
        target: staged.target,
        transport: {
          status: transport.status,
          ...(transport.status === 'committed' ? { commitSha: transport.commitSha } : {}),
        },
        items,
        summary: finalSummary(items),
      });
    } catch (error) {
      await lifecycle?.failPending(error, { currentStage: 'done' });
      throw error;
    }
  }

  function sync(input: {
    conversationIds?: readonly unknown[];
    mode?: GithubSyncPlannerMode;
    instanceId?: string;
  }): Promise<GithubSyncRunResult> {
    return ownership.startRun(() => runSync(input));
  }

  return {
    sync,
    getSyncStatus,
    clearSyncStatus,
    isRunActive: () => ownership.isRunActive(),
    runExclusiveMaintenance,
    reconcileStartupSyncJob,
  };
}
