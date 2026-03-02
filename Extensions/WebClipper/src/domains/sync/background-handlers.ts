import { NOTION_MESSAGE_TYPES, OBSIDIAN_MESSAGE_TYPES } from '../../platform/messaging/message-contracts';

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
  router.register(NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS, async () => {
    const NS: any = (globalThis as any).WebClipper || {};
    const notionSyncOrchestrator = NS.notionSyncOrchestrator;
    if (!notionSyncOrchestrator || typeof notionSyncOrchestrator.getSyncJobStatus !== 'function') {
      return router.err('notion sync orchestrator missing');
    }
    const data = await notionSyncOrchestrator.getSyncJobStatus({ instanceId: getInstanceId() });
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
}

