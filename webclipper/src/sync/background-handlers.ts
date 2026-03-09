import { NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES } from '../platform/messaging/message-contracts';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

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

export function registerSyncHandlers(router: AnyRouter, deps: Deps) {
  router.register(NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    try {
      const data = await deps.notionSyncOrchestrator.syncConversations({
        conversationIds: msg?.conversationIds,
        instanceId: deps.getInstanceId(),
      });
      return router.ok(data);
    } catch (error) {
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
    try {
      const data = await deps.obsidianSyncOrchestrator.syncConversations({
        conversationIds: msg?.conversationIds,
        forceFullConversationIds: msg?.forceFullConversationIds,
        instanceId: deps.getInstanceId(),
      });
      return router.ok(data);
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });
}
