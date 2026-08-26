import type { GithubStagedOperation } from '@services/sync/github/github-git-transport';
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

  return { stage };
}

export const githubSyncOrchestrator = createGithubSyncOrchestrator();
