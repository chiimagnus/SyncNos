import type { SyncJobSnapshot, SyncPerConversationResult } from '@services/sync/models';

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
  persist: PersistSyncJob;
  now?: () => number;
};

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function positiveId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('invalid conversation id');
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
  const configuredIds = options.initialJob.conversationIds.map(positiveId);
  const configuredIdSet = new Set(configuredIds);
  let snapshot: SyncJobSnapshot = {
    ...options.initialJob,
    conversationIds: [...configuredIds],
    perConversation: [],
  };
  let persistChain: Promise<boolean> = Promise.resolve(true);

  const rememberTitle = (conversationId: number, candidate: unknown): string => {
    const id = positiveId(conversationId);
    const next = safeString(candidate);
    if (next) titles.set(id, next);
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

  const refreshResultSnapshot = () => {
    const perConversation = orderedResults();
    snapshot = {
      ...snapshot,
      okCount: perConversation.filter((row) => row.ok).length,
      failCount: perConversation.filter((row) => !row.ok).length,
      perConversation,
    };
  };

  const persistCurrent = async (): Promise<boolean> => {
    const value = cloneSnapshot(snapshot);
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

  const recordResult = <T extends SyncJobResultInput>(input: T): T & SyncPerConversationResult => {
    const row = normalizeResult(input);
    results.set(row.conversationId, cloneRow(row));
    refreshResultSnapshot();
    return cloneRow(row);
  };

  for (const row of options.initialJob.perConversation) recordResult(row as SyncJobResultInput);
  if (options.initialJob.currentConversationId) {
    rememberTitle(options.initialJob.currentConversationId, options.initialJob.currentConversationTitle);
  }
  refreshResultSnapshot();

  const setItem = async (
    conversationId: number,
    input: { conversationTitle?: unknown; currentStage: string },
  ): Promise<boolean> => {
    const id = positiveId(conversationId);
    const title = rememberTitle(id, input.conversationTitle);
    snapshot = {
      ...snapshot,
      status: 'running',
      updatedAt: now(),
      currentConversationId: id,
      currentConversationTitle: title || undefined,
      currentStage: safeString(input.currentStage),
    };
    return persistCurrent();
  };

  const setRunStage = async (currentStage: string): Promise<boolean> => {
    snapshot = {
      ...snapshot,
      status: 'running',
      updatedAt: now(),
      currentConversationId: undefined,
      currentConversationTitle: undefined,
      currentStage: safeString(currentStage),
    };
    return persistCurrent();
  };

  const finishItem = async (conversationId: number, currentStage = 'finishing_current_item'): Promise<boolean> => {
    const id = positiveId(conversationId);
    const title = titles.get(id) ?? '';
    snapshot = {
      ...snapshot,
      status: 'running',
      updatedAt: now(),
      currentConversationId: id,
      currentConversationTitle: title || undefined,
      currentStage: safeString(currentStage),
    };
    return persistCurrent();
  };

  const completeItem = async <T extends SyncJobResultInput>(
    input: T,
    currentStage = 'finishing_current_item',
  ): Promise<{ row: T & SyncPerConversationResult; persisted: boolean }> => {
    const row = recordResult(input);
    const persisted = await finishItem(row.conversationId, currentStage);
    return { row, persisted };
  };

  const finish = async (
    rows?: readonly SyncJobResultInput[],
    input: { currentStage?: string } = {},
  ): Promise<boolean> => {
    if (rows) {
      results.clear();
      for (const row of rows) recordResult(row);
    }
    refreshResultSnapshot();
    const finishedAt = now();
    snapshot = {
      ...snapshot,
      status: 'done',
      updatedAt: finishedAt,
      finishedAt,
      currentConversationId: undefined,
      currentConversationTitle: undefined,
      currentStage: input.currentStage == null ? undefined : safeString(input.currentStage),
    };
    return persistCurrent();
  };

  const failPending = async (
    error: unknown,
    input: { mode?: string; currentStage?: string; warnings?: unknown[] } = {},
  ): Promise<boolean> => {
    const message = safeString((error as any)?.code || (error as any)?.message || error || 'sync failed');
    for (const conversationId of configuredIds) {
      if (results.has(conversationId)) continue;
      recordResult({
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
    titleFor: (conversationId: number) => titles.get(positiveId(conversationId)) ?? '',
    results: () => orderedResults(),
  };
}

export type SyncJobLifecycle = ReturnType<typeof createSyncJobLifecycle>;
