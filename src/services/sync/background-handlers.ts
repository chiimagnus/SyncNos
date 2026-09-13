import {
  FEISHU_MESSAGE_TYPES,
  GITHUB_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
} from '@platform/messaging/message-contracts';
import { getNotionOAuthToken } from '@services/sync/notion/auth/token-store';
import { getNotionParentPage } from '@services/sync/notion/settings-store';
import { getFeishuOAuthToken } from '@services/sync/feishu/auth/token-store';
import { ensureSyncProviderEnabled } from '@services/sync/sync-provider-gate';
import { normalizeSyncConversationIds } from '@services/sync/sync-conversation-ids';
import { createSyncJobId } from '@services/sync/sync-job-lifecycle';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

type Deps = {
  getInstanceId: () => string;
  notionSyncOrchestrator: {
    syncConversations: (input: { conversationIds?: unknown[]; instanceId: string; jobId?: string }) => Promise<unknown>;
    getSyncJobStatus: () => Promise<unknown>;
    clearSyncJobStatus: () => Promise<unknown>;
    isRunActive: () => boolean;
  };
  obsidianSyncOrchestrator: {
    testConnection: (input: { instanceId: string }) => Promise<any>;
    syncConversations: (input: {
      conversationIds?: unknown[];
      forceFullConversationIds?: unknown[];
      instanceId: string;
      jobId?: string;
    }) => Promise<unknown>;
    getSyncStatus: () => Promise<unknown>;
    clearSyncStatus: () => Promise<unknown>;
    isRunActive: () => boolean;
  };
  feishuSyncOrchestrator: {
    syncConversations: (input: { conversationIds?: unknown[]; instanceId: string; jobId?: string }) => Promise<unknown>;
    getSyncStatus: () => Promise<unknown>;
    clearSyncStatus: () => Promise<unknown>;
    isRunActive: () => boolean;
  };
  githubSyncOrchestrator: {
    sync: (input: {
      conversationIds?: readonly number[];
      mode?: 'incremental' | 'reconcile';
      instanceId?: string;
      jobId?: string;
    }) => Promise<unknown>;
    getSyncStatus: () => Promise<unknown>;
    clearSyncStatus: () => Promise<unknown>;
    isRunActive: () => boolean;
  };
};

function toSyncErrorResponse(router: AnyRouter, error: unknown) {
  const message = String((error as any)?.message ?? error ?? 'sync failed');
  const extra = (error as any)?.extra && typeof (error as any).extra === 'object' ? (error as any).extra : null;
  const code = String((extra as any)?.code ?? (error as any)?.code ?? '').trim();
  if (code) return router.err(message, { ...(extra || {}), code });
  if (extra) return router.err(message, extra);
  return router.err(message);
}

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function buildObsidianPreflightFailure(preflight: any) {
  const error = preflight && typeof preflight === 'object' ? (preflight as any).error : null;
  const code = safeString(error?.code).toLowerCase();
  const detail = safeString(error?.message) || 'connection test failed';

  const hintPrimary = 'Open Obsidian and ensure the Local REST API plugin is enabled.';
  const hintSecondary = 'If this persists, check Settings -> Obsidian Local REST API (Base URL / API Key).';
  const message = `Obsidian connection test failed. ${hintPrimary} ${hintSecondary} Details: ${detail}`.trim();

  return {
    message,
    extra: {
      code: code || 'preflight_failed',
      provider: 'obsidian',
      stage: 'preflight',
      detail: { code: code || null, message: detail },
    },
  };
}

export function registerSyncHandlers(router: AnyRouter, deps: Deps) {
  router.register(NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    try {
      const gateError = await ensureSyncProviderEnabled('notion');
      if (gateError) return router.err('sync provider disabled', gateError);

      const conversationIds = normalizeSyncConversationIds(msg?.conversationIds);
      if (!conversationIds.length) return router.err('no conversationIds');

      const instanceId = deps.getInstanceId();
      const token = await getNotionOAuthToken().catch(() => null);
      if (!token?.accessToken) return router.err('notion not connected');

      const parentPageId = (await getNotionParentPage()).id;
      if (!parentPageId) return router.err('missing parentPageId');

      const jobId = createSyncJobId();
      const run = deps.notionSyncOrchestrator.syncConversations({ conversationIds, instanceId, jobId });
      void run.catch(() => {});
      return router.ok({ started: true, provider: 'notion', jobId });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(NOTION_MESSAGE_TYPES.GET_SYNC_JOB_STATUS, async () => {
    try {
      const data: any = await deps.notionSyncOrchestrator.getSyncJobStatus();
      return router.ok({ ...data, active: deps.notionSyncOrchestrator.isRunActive() });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(NOTION_MESSAGE_TYPES.CLEAR_SYNC_JOB_STATUS, async () => {
    try {
      const data: any = await deps.notionSyncOrchestrator.clearSyncJobStatus();
      return router.ok({ ...data, active: false });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.GET_SYNC_STATUS, async () => {
    try {
      const data: any = await deps.obsidianSyncOrchestrator.getSyncStatus();
      return router.ok({ ...data, active: deps.obsidianSyncOrchestrator.isRunActive() });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.CLEAR_SYNC_STATUS, async () => {
    try {
      const data: any = await deps.obsidianSyncOrchestrator.clearSyncStatus();
      return router.ok({ ...data, active: false });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(OBSIDIAN_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    try {
      const gateError = await ensureSyncProviderEnabled('obsidian');
      if (gateError) return router.err('sync provider disabled', gateError);

      const conversationIds = normalizeSyncConversationIds(msg?.conversationIds);
      if (!conversationIds.length) return router.err('no conversationIds');
      const forceFullConversationIds = normalizeSyncConversationIds(msg?.forceFullConversationIds);
      const instanceId = deps.getInstanceId();

      const preflight = await deps.obsidianSyncOrchestrator.testConnection({ instanceId }).catch((e: any) => ({
        ok: false,
        error: { code: 'network_error', message: e?.message ? String(e.message) : 'connection test failed' },
      }));
      if (!preflight || (preflight as any).ok !== true) {
        const failure = buildObsidianPreflightFailure(preflight);
        return router.err(failure.message, failure.extra);
      }

      const jobId = createSyncJobId();
      const run = deps.obsidianSyncOrchestrator.syncConversations({
        conversationIds,
        forceFullConversationIds,
        instanceId,
        jobId,
      });
      void run.catch(() => {});
      return router.ok({ started: true, provider: 'obsidian', jobId });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(FEISHU_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    try {
      const gateError = await ensureSyncProviderEnabled('feishu');
      if (gateError) return router.err('sync provider disabled', gateError);

      const conversationIds = normalizeSyncConversationIds(msg?.conversationIds);
      if (!conversationIds.length) return router.err('no conversationIds');

      const instanceId = deps.getInstanceId();
      const token = await getFeishuOAuthToken().catch(() => null);
      if (!token?.accessToken) return router.err('feishu not connected');

      const jobId = createSyncJobId();
      const run = deps.feishuSyncOrchestrator.syncConversations({ conversationIds, instanceId, jobId });
      void run.catch(() => {});
      return router.ok({ started: true, provider: 'feishu', jobId });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(FEISHU_MESSAGE_TYPES.GET_SYNC_STATUS, async () => {
    try {
      const data: any = await deps.feishuSyncOrchestrator.getSyncStatus();
      return router.ok({ ...data, active: deps.feishuSyncOrchestrator.isRunActive() });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(FEISHU_MESSAGE_TYPES.CLEAR_SYNC_STATUS, async () => {
    try {
      const data: any = await deps.feishuSyncOrchestrator.clearSyncStatus();
      return router.ok({ ...data, active: false });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(GITHUB_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    try {
      const gateError = await ensureSyncProviderEnabled('github');
      if (gateError) return router.err('sync provider disabled', gateError);

      const conversationIds = normalizeSyncConversationIds(msg?.conversationIds);
      if (!conversationIds.length) return router.err('no conversationIds');

      const instanceId = deps.getInstanceId();
      const jobId = createSyncJobId();
      const run = deps.githubSyncOrchestrator.sync({ conversationIds, mode: 'reconcile', instanceId, jobId });
      void run.catch(() => {});
      return router.ok({ started: true, provider: 'github', jobId });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(GITHUB_MESSAGE_TYPES.GET_SYNC_STATUS, async () => {
    try {
      const data: any = await deps.githubSyncOrchestrator.getSyncStatus();
      return router.ok({ ...data, active: deps.githubSyncOrchestrator.isRunActive() });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(GITHUB_MESSAGE_TYPES.CLEAR_SYNC_STATUS, async () => {
    try {
      const data: any = await deps.githubSyncOrchestrator.clearSyncStatus();
      return router.ok({ ...data, active: false });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });
}
