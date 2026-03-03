import { NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES } from '../platform/messaging/message-contracts';
import {
  getNotionSyncStatus,
  notionSyncConversations,
} from '../integrations/notion/sync/orchestrator';
import {
  getObsidianSyncStatus,
  obsidianSyncConversations,
} from '../integrations/obsidian/sync/orchestrator';
import runtimeContext from '../runtime-context.ts';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

function getInstanceId(): string {
  try {
    const id = runtimeContext.__backgroundInstanceId;
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
    const data = await getObsidianSyncStatus({ instanceId: getInstanceId() });
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    const data = await obsidianSyncConversations({
      conversationIds: msg?.conversationIds,
      forceFullConversationIds: msg?.forceFullConversationIds,
      instanceId: getInstanceId(),
    });
    return router.ok(data);
  });
}
