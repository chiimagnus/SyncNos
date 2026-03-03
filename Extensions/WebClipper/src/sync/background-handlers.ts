import { NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES } from '../platform/messaging/message-contracts';
import {
  getSyncJobStatus as getNotionSyncStatus,
  syncConversations as notionSyncConversations,
} from './notion/notion-sync-orchestrator';
import {
  getObsidianSyncStatus,
  obsidianSyncConversations,
} from './obsidian/orchestrator';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

type Deps = {
  getInstanceId: () => string;
};

export function registerSyncHandlers(router: AnyRouter, deps: Deps) {
  router.register(NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    const data = await notionSyncConversations({
      conversationIds: msg?.conversationIds,
      instanceId: deps.getInstanceId(),
    });
    return router.ok(data);
  });

  router.register(NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS, async () => {
    const data = await getNotionSyncStatus({ instanceId: deps.getInstanceId() });
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.GET_SYNC_STATUS, async () => {
    const data = await getObsidianSyncStatus({ instanceId: deps.getInstanceId() });
    return router.ok(data);
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    const data = await obsidianSyncConversations({
      conversationIds: msg?.conversationIds,
      forceFullConversationIds: msg?.forceFullConversationIds,
      instanceId: deps.getInstanceId(),
    });
    return router.ok(data);
  });
}
