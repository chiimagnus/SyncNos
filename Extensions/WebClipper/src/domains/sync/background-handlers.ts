import { NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES } from '../../platform/messaging/message-contracts';
import {
  getNotionSyncStatus,
  notionSyncConversations,
} from '../../integrations/notion/sync/orchestrator';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

function getInstanceId(): string {
  try {
    const NS: any = (globalThis as any).WebClipper || {};
    const id = NS.__backgroundInstanceId;
    return id ? String(id) : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  } catch (_e) {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

export function registerSyncHandlers(router: AnyRouter) {
  router.register(NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    const data = await notionSyncConversations({
      conversationIds: msg?.conversationIds,
      instanceId: getInstanceId(),
    });
    return router.ok(data);
  });

  router.register(NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS, async () => {
    const data = await getNotionSyncStatus({ instanceId: getInstanceId() });
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.GET_SYNC_STATUS, async () => {
    const NS: any = (globalThis as any).WebClipper || {};
    const orchestrator = NS.obsidianSyncOrchestrator;
    if (!orchestrator || typeof orchestrator.getSyncStatus !== 'function') {
      return router.err('obsidian sync orchestrator missing');
    }
    const data = await orchestrator.getSyncStatus({ instanceId: getInstanceId() });
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    const NS: any = (globalThis as any).WebClipper || {};
    const orchestrator = NS.obsidianSyncOrchestrator;
    if (!orchestrator || typeof orchestrator.syncConversations !== 'function') {
      return router.err('obsidian sync orchestrator missing');
    }
    const data = await orchestrator.syncConversations({
      conversationIds: msg?.conversationIds,
      forceFullConversationIds: msg?.forceFullConversationIds,
      instanceId: getInstanceId(),
    });
    return router.ok(data);
  });
}
