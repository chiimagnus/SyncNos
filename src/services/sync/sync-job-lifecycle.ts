import type { SyncJobSnapshot, SyncPerConversationResult, SyncRunSummary } from '@services/sync/models';
import { normalizeSyncConversationId, normalizeSyncConversationIds } from '@services/sync/sync-conversation-ids';

type SyncJobResultInput = Record<string, any> & {
  conversationId: number;
  conversationTitle?: unknown;
  ok: unknown;
  mode?: unknown;
  appended?: unknown;
  error?: unknown;
  warnings?: unknown[];
  at?: unknown;
};

type PersistSyncJob = (job: SyncJobSnapshot) => boolean | void | Promise<boolean | void>;

type SyncJobLifecycleOptions = {
  initialJob: SyncJobSnapshot;
  configuredConversationIds: readonly unknown[];
  persist: PersistSyncJob;
  now?: () => number;
};

type ActiveItem = {
  id: number;
  title: string;
  stage: string;
};

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function positiveId(value: unknown): number {
  const id = normalizeSyncConversationId(value);
  if (id == null) throw new Error('invalid conversation id');
  return id;
}

function cloneWarnings(value: unknown): any[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((warning) =>
    warning && typeof warning === 'object' && !Array.isArray(warning) ? { ...warning } : warning,
  );
}

function cloneRow<T extends Record<string, any>>(row: T): T {
  const warnings = cloneWarnings(row.warnings);
  return {
    ...row,
    ...(warnings === undefined ? {} : { warnings }),
  };
}

function cloneSnapshot(snapshot: SyncJobSnapshot): SyncJobSnapshot {
  return {
    ...snapshot,
    conversationIds: [...snapshot.conversationIds],
    perConversation: snapshot.perConversation.map((row) => cloneRow(row)),
  };
}

/**
 * Owns the provider-independent SyncJob item lifecycle.
 *
 * A title is monotonic per conversation id: once a non-empty title is known,
 * later empty progress/error payloads cannot erase it.
 */
export function createSyncJobLifecycle(options: SyncJobLifecycleOptions) {
  const now = options.now ?? Date.now;
  const titles = new Map<number, string>();
  const results = new Map<number, SyncPerConversationResult & Record<string, any>>();
  const activeItems = new Map<number, ActiveItem>();
  const configuredIds = normalizeSyncConversationIds(options.configuredConversationIds);
  const configuredIdSet = new Set(configuredIds);
  let okCount = 0;
  let failCount = 0;
  const totalCount = configuredIds.length;
  let snapshot: SyncJobSnapshot = {
    ...options.initialJob,
    totalCount,
    conversationIds: [],
    perConversation: [],
    okCount: 0,
    failCount: 0,
  };
  let persistChain: Promise<boolean> = Promise.resolve(true);

  const rememberTitle = (conversationId: number, candidate: unknown): string => {
    const id = positiveId(conversationId);
    const next = safeString(candidate);
    if (next) {
      titles.set(id, next);
      const active = activeItems.get(id);
      if (active) active.title = next;
    }
    return titles.get(id) ?? '';
  };

  const orderedResults = (): Array<SyncPerConversationResult & Record<string, any>> => {
    const rows: Array<SyncPerConversationResult & Record<string, any>> = [];
    for (const id of configuredIds) {
      const row = results.get(id);
      if (row) rows.push(cloneRow(row));
    }
    for (const [id, row] of results) {
      if (!configuredIdSet.has(id)) rows.push(cloneRow(row));
    }
    return rows;
  };

  const latestActiveItem = (): ActiveItem | null => {
    let latest: ActiveItem | null = null;
    for (const item of activeItems.values()) latest = item;
    return latest;
  };

  const applyCurrentItem = (item: ActiveItem | null) => {
    snapshot = {
      ...snapshot,
      currentConversationId: item?.id,
      currentConversationTitle: item?.title || undefined,
      currentStage: item?.stage,
    };
  };

  const materializeSnapshot = (): SyncJobSnapshot => {
    if (snapshot.status === 'running') {
      return cloneSnapshot({
        ...snapshot,
        totalCount,
        okCount,
        failCount,
        conversationIds: [],
        perConversation: [],
      });
    }

    const perConversation = orderedResults();
    const conversationIds = perConversation.map((row) => row.conversationId);
    return cloneSnapshot({
      ...snapshot,
      totalCount: conversationIds.length,
      okCount,
      failCount,
      conversationIds,
      perConversation,
    });
  };

  const persistCurrent = async (): Promise<boolean> => {
    const value = materializeSnapshot();
    const next = persistChain
      .catch(() => false)
      .then(async () => {
        try {
          return (await options.persist(value)) !== false;
        } catch (_error) {
          return false;
        }
      });
    persistChain = next;
    return next;
  };

  const normalizeResult = <T extends SyncJobResultInput>(input: T): T & SyncPerConversationResult => {
    const conversationId = positiveId(input.conversationId);
    const conversationTitle = rememberTitle(conversationId, input.conversationTitle);
    const appended = Number(input.appended);
    const at = Number(input.at);
    const warnings = cloneWarnings(input.warnings);
    return {
      ...input,
      conversationId,
      conversationTitle: conversationTitle || undefined,
      ok: input.ok === true,
      mode: safeString(input.mode) || (input.ok === true ? 'ok' : 'failed'),
      appended: Number.isFinite(appended) ? appended : 0,
      error: safeString(input.error),
      ...(warnings === undefined ? { warnings: undefined } : { warnings }),
      at: Number.isFinite(at) ? at : now(),
    } as T & SyncPerConversationResult;
  };

  const upsertResult = <T extends SyncJobResultInput>(input: T): T & SyncPerConversationResult => {
    const row = normalizeResult(input);
    const previous = results.get(row.conversationId);
    if (previous) {
      if (previous.ok) okCount -= 1;
      else failCount -= 1;
    }
    results.set(row.conversationId, cloneRow(row));
    if (row.ok) okCount += 1;
    else failCount += 1;
    snapshot = { ...snapshot, okCount, failCount };
    return cloneRow(row);
  };

  const recordResult = <T extends SyncJobResultInput>(input: T): T & SyncPerConversationResult => upsertResult(input);

  const setItem = async (
    conversationId: number,
    input: { conversationTitle?: unknown; currentStage: string },
  ): Promise<boolean> => {
    const id = positiveId(conversationId);
    const title = rememberTitle(id, input.conversationTitle);
    const stage = safeString(input.currentStage);
    activeItems.delete(id);
    activeItems.set(id, { id, title, stage });
    snapshot = {
      ...snapshot,
      status: 'running',
      updatedAt: now(),
      currentConversationId: id,
      currentConversationTitle: title || undefined,
      currentStage: stage,
      okCount,
      failCount,
    };
    return persistCurrent();
  };

  const setRunStage = async (currentStage: string): Promise<boolean> => {
    activeItems.clear();
    snapshot = {
      ...snapshot,
      status: 'running',
      updatedAt: now(),
      currentConversationId: undefined,
      currentConversationTitle: undefined,
      currentStage: safeString(currentStage),
      okCount,
      failCount,
    };
    return persistCurrent();
  };

  const finishItem = async (conversationId: number, input: { persist?: boolean } = {}): Promise<boolean> => {
    const id = positiveId(conversationId);
    const wasActive = activeItems.delete(id);
    if (wasActive && snapshot.currentConversationId === id) applyCurrentItem(latestActiveItem());
    snapshot = {
      ...snapshot,
      status: 'running',
      updatedAt: now(),
      okCount,
      failCount,
    };
    if (input.persist === false) return true;
    return persistCurrent();
  };

  const completeItem = async <T extends SyncJobResultInput>(
    input: T,
  ): Promise<{ row: T & SyncPerConversationResult; persisted: boolean }> => {
    const row = recordResult(input);
    const persisted = await finishItem(row.conversationId);
    return { row, persisted };
  };

  const finish = async (
    rows?: readonly SyncJobResultInput[],
    input: { currentStage?: string } = {},
  ): Promise<boolean> => {
    if (rows) {
      results.clear();
      okCount = 0;
      failCount = 0;
      for (const row of rows) upsertResult(row);
    }
    activeItems.clear();
    const finishedAt = now();
    snapshot = {
      ...snapshot,
      status: 'done',
      updatedAt: finishedAt,
      finishedAt,
      currentConversationId: undefined,
      currentConversationTitle: undefined,
      currentStage: input.currentStage == null ? undefined : safeString(input.currentStage),
      okCount,
      failCount,
    };
    return persistCurrent();
  };

  const summary = (): SyncRunSummary => {
    const rows = orderedResults();
    return {
      provider: snapshot.provider,
      okCount,
      failCount,
      failures: rows
        .filter((row) => !row.ok)
        .map((row) => ({
          conversationId: row.conversationId,
          conversationTitle: safeString(row.conversationTitle),
          error: safeString(row.error) || 'unknown error',
        })),
      results: rows,
      instanceId: safeString(snapshot.instanceId),
    };
  };

  const failPending = async (
    error: unknown,
    input: { mode?: string; currentStage?: string; warnings?: unknown[] } = {},
  ): Promise<boolean> => {
    const message = safeString((error as any)?.code || (error as any)?.message || error || 'sync failed');
    for (const conversationId of configuredIds) {
      if (results.has(conversationId)) continue;
      upsertResult({
        conversationId,
        conversationTitle: titles.get(conversationId),
        ok: false,
        mode: safeString(input.mode) || 'failed',
        appended: 0,
        error: message,
        warnings: input.warnings ?? [],
        at: now(),
      });
    }
    return finish(undefined, { currentStage: input.currentStage });
  };

  return {
    setItem,
    setRunStage,
    recordResult,
    completeItem,
    finishItem,
    finish,
    failPending,
    summary,
    titleFor: (conversationId: number) => titles.get(positiveId(conversationId)) ?? '',
  };
}

export type SyncJobLifecycle = ReturnType<typeof createSyncJobLifecycle>;
