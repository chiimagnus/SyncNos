import { NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES } from '../platform/messaging/message-contracts';
import { storageGet } from '../platform/storage/local';
import { getNotionOAuthToken } from './notion/auth/token-store';
import { ensureSyncProviderEnabled } from './sync-provider-gate';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

let notionDetachedRun: Promise<unknown> | null = null;
let obsidianDetachedRun: Promise<unknown> | null = null;

type Deps = {
  getInstanceId: () => string;
  notionSyncOrchestrator: {
    syncConversations: (input: { conversationIds?: unknown[]; instanceId: string }) => Promise<unknown>;
    getSyncJobStatus: (input: { instanceId: string }) => Promise<unknown>;
    clearSyncJobStatus: (input: { instanceId: string }) => Promise<unknown>;
  };
  obsidianSyncOrchestrator: {
    syncConversations: (input: {
      conversationIds?: unknown[];
      forceFullConversationIds?: unknown[];
      instanceId: string;
    }) => Promise<unknown>;
    getSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
    clearSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
  };
};

function toSyncErrorResponse(router: AnyRouter, error: unknown) {
  const message = String((error as any)?.message ?? error ?? 'sync failed');
  const code = String((error as any)?.code ?? '').trim();
  if (code) return router.err(message, { code });
  return router.err(message);
}

function normalizeIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(
    new Set(
      ids
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0),
    ),
  );
}

export function registerSyncHandlers(router: AnyRouter, deps: Deps) {
  router.register(NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    let lock: Promise<unknown> | null = null;
    const releaseLock = () => {
      if (lock && notionDetachedRun === lock) notionDetachedRun = null;
    };
    try {
      const gateError = await ensureSyncProviderEnabled('notion');
      if (gateError) return router.err('sync provider disabled', gateError);

      if (notionDetachedRun) {
        return router.err('sync already in progress', { code: 'sync_already_running' });
      }

      const conversationIds = normalizeIds(msg?.conversationIds);
      if (!conversationIds.length) return router.err('no conversationIds');

      // Acquire the lock before any async work, so concurrent requests can't race past the check.
      lock = Promise.resolve();
      notionDetachedRun = lock;

      const instanceId = deps.getInstanceId();
      const status = await deps.notionSyncOrchestrator.getSyncJobStatus({ instanceId });
      const currentJob = (status as any)?.job;
      if (currentJob?.status === 'running') {
        releaseLock();
        return router.err('sync already in progress', { code: 'sync_already_running' });
      }

      const token = await getNotionOAuthToken().catch(() => null);
      if (!token?.accessToken) {
        releaseLock();
        return router.err('notion not connected');
      }

      const res = await storageGet(['notion_parent_page_id']).catch(() => ({}));
      const parentPageId = String((res as any)?.notion_parent_page_id || '').trim();
      if (!parentPageId) {
        releaseLock();
        return router.err('missing parentPageId');
      }

      const run = deps.notionSyncOrchestrator.syncConversations({ conversationIds, instanceId });
      notionDetachedRun = run;
      void run
        .finally(() => {
          if (notionDetachedRun === run) notionDetachedRun = null;
        })
        .catch(() => {});
      return router.ok({ started: true, provider: 'notion' });
    } catch (error) {
      releaseLock();
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS, async () => {
    const data = await deps.notionSyncOrchestrator.getSyncJobStatus({ instanceId: deps.getInstanceId() });
    return router.ok(data);
  });

  router.register(NOTION_MESSAGE_TYPES.CLEAR_SYNC_JOB_STATUS, async () => {
    const data = await deps.notionSyncOrchestrator.clearSyncJobStatus({ instanceId: deps.getInstanceId() });
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.GET_SYNC_STATUS, async () => {
    const data = await deps.obsidianSyncOrchestrator.getSyncStatus({ instanceId: deps.getInstanceId() });
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.CLEAR_SYNC_STATUS, async () => {
    const data = await deps.obsidianSyncOrchestrator.clearSyncStatus({ instanceId: deps.getInstanceId() });
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    let lock: Promise<unknown> | null = null;
    const releaseLock = () => {
      if (lock && obsidianDetachedRun === lock) obsidianDetachedRun = null;
    };
    try {
      const gateError = await ensureSyncProviderEnabled('obsidian');
      if (gateError) return router.err('sync provider disabled', gateError);

      if (obsidianDetachedRun) {
        return router.err('sync already in progress', { code: 'sync_already_running' });
      }

      const conversationIds = normalizeIds(msg?.conversationIds);
      if (!conversationIds.length) return router.err('no conversationIds');

      const forceFullConversationIds = normalizeIds(msg?.forceFullConversationIds);

      // Acquire the lock before any async work, so concurrent requests can't race past the check.
      lock = Promise.resolve();
      obsidianDetachedRun = lock;

      const instanceId = deps.getInstanceId();
      const status = await deps.obsidianSyncOrchestrator.getSyncStatus({ instanceId });
      const currentJob = (status as any)?.job;
      if (currentJob?.status === 'running') {
        releaseLock();
        return router.err('sync already in progress', { code: 'sync_already_running' });
      }

      const run = deps.obsidianSyncOrchestrator.syncConversations({ conversationIds, forceFullConversationIds, instanceId });
      obsidianDetachedRun = run;
      void run
        .finally(() => {
          if (obsidianDetachedRun === run) obsidianDetachedRun = null;
        })
        .catch(() => {});
      return router.ok({ started: true, provider: 'obsidian' });
    } catch (error) {
      releaseLock();
      return toSyncErrorResponse(router, error);
    }
  });
}
