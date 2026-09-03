import {
  FEISHU_MESSAGE_TYPES,
  GITHUB_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
} from '@platform/messaging/message-contracts';
import { storageGet } from '@platform/storage/local';
import { getNotionOAuthToken } from '@services/sync/notion/auth/token-store';
import { getFeishuOAuthToken } from '@services/sync/feishu/auth/token-store';
import { ensureSyncProviderEnabled } from '@services/sync/sync-provider-gate';
import { normalizeSyncConversationIds } from '@services/sync/sync-conversation-ids';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

let notionDetachedRun: Promise<unknown> | null = null;
let obsidianDetachedRun: Promise<unknown> | null = null;
let feishuDetachedRun: Promise<unknown> | null = null;
let githubDetachedRun: Promise<unknown> | null = null;

type Deps = {
  getInstanceId: () => string;
  notionSyncOrchestrator: {
    syncConversations: (input: { conversationIds?: unknown[]; instanceId: string }) => Promise<unknown>;
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
    }) => Promise<unknown>;
    getSyncStatus: () => Promise<unknown>;
    clearSyncStatus: () => Promise<unknown>;
    isRunActive: () => boolean;
  };
  feishuSyncOrchestrator: {
    syncConversations: (input: { conversationIds?: unknown[]; instanceId: string }) => Promise<unknown>;
    getSyncStatus: () => Promise<unknown>;
    clearSyncStatus: () => Promise<unknown>;
    isRunActive: () => boolean;
  };
  githubSyncOrchestrator: {
    sync: (input: {
      conversationIds?: readonly unknown[];
      mode?: 'incremental' | 'reconcile';
      instanceId?: string;
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

      const conversationIds = normalizeSyncConversationIds(msg?.conversationIds);
      if (!conversationIds.length) return router.err('no conversationIds');

      // Acquire the lock before any async work, so concurrent requests can't race past the check.
      lock = Promise.resolve();
      notionDetachedRun = lock;

      const instanceId = deps.getInstanceId();
      if (deps.notionSyncOrchestrator.isRunActive()) {
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
    try {
      const data: any = await deps.notionSyncOrchestrator.getSyncJobStatus();
      return router.ok({ ...data, active: Boolean(notionDetachedRun) || deps.notionSyncOrchestrator.isRunActive() });
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
      return router.ok({
        ...data,
        active: Boolean(obsidianDetachedRun) || deps.obsidianSyncOrchestrator.isRunActive(),
      });
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

      const conversationIds = normalizeSyncConversationIds(msg?.conversationIds);
      if (!conversationIds.length) return router.err('no conversationIds');

      const forceFullConversationIds = normalizeSyncConversationIds(msg?.forceFullConversationIds);

      // Acquire the lock before any async work, so concurrent requests can't race past the check.
      lock = Promise.resolve();
      obsidianDetachedRun = lock;

      const instanceId = deps.getInstanceId();
      if (deps.obsidianSyncOrchestrator.isRunActive()) {
        releaseLock();
        return router.err('sync already in progress', { code: 'sync_already_running' });
      }

      const preflight = await deps.obsidianSyncOrchestrator.testConnection({ instanceId }).catch((e: any) => ({
        ok: false,
        error: { code: 'network_error', message: e?.message ? String(e.message) : 'connection test failed' },
      }));
      if (!preflight || (preflight as any).ok !== true) {
        releaseLock();
        const failure = buildObsidianPreflightFailure(preflight);
        return router.err(failure.message, failure.extra);
      }

      const run = deps.obsidianSyncOrchestrator.syncConversations({
        conversationIds,
        forceFullConversationIds,
        instanceId,
      });
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

  router.register(FEISHU_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    let lock: Promise<unknown> | null = null;
    const releaseLock = () => {
      if (lock && feishuDetachedRun === lock) feishuDetachedRun = null;
    };
    try {
      const gateError = await ensureSyncProviderEnabled('feishu');
      if (gateError) return router.err('sync provider disabled', gateError);

      if (feishuDetachedRun) {
        return router.err('sync already in progress', { code: 'sync_already_running' });
      }

      const conversationIds = normalizeSyncConversationIds(msg?.conversationIds);
      if (!conversationIds.length) return router.err('no conversationIds');

      // Acquire the lock before any async work, so concurrent requests can't race past the check.
      lock = Promise.resolve();
      feishuDetachedRun = lock;

      const instanceId = deps.getInstanceId();
      if (deps.feishuSyncOrchestrator.isRunActive()) {
        releaseLock();
        return router.err('sync already in progress', { code: 'sync_already_running' });
      }

      const token = await getFeishuOAuthToken().catch(() => null);
      if (!token?.accessToken) {
        releaseLock();
        return router.err('feishu not connected');
      }

      const run = deps.feishuSyncOrchestrator.syncConversations({ conversationIds, instanceId });
      feishuDetachedRun = run;
      void run
        .finally(() => {
          if (feishuDetachedRun === run) feishuDetachedRun = null;
        })
        .catch(() => {});
      return router.ok({ started: true, provider: 'feishu' });
    } catch (error) {
      releaseLock();
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(FEISHU_MESSAGE_TYPES.GET_SYNC_STATUS, async () => {
    try {
      const data: any = await deps.feishuSyncOrchestrator.getSyncStatus();
      return router.ok({ ...data, active: Boolean(feishuDetachedRun) || deps.feishuSyncOrchestrator.isRunActive() });
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
    let lock: Promise<unknown> | null = null;
    const releaseLock = () => {
      if (lock && githubDetachedRun === lock) githubDetachedRun = null;
    };
    try {
      const gateError = await ensureSyncProviderEnabled('github');
      if (gateError) return router.err('sync provider disabled', gateError);
      if (githubDetachedRun) return router.err('sync already in progress', { code: 'sync_already_running' });

      const conversationIds = normalizeSyncConversationIds(msg?.conversationIds);
      if (!conversationIds.length) return router.err('no conversationIds');

      lock = Promise.resolve();
      githubDetachedRun = lock;
      const instanceId = deps.getInstanceId();
      if (deps.githubSyncOrchestrator.isRunActive()) {
        releaseLock();
        return router.err('sync already in progress', { code: 'sync_already_running' });
      }

      const run = deps.githubSyncOrchestrator.sync({ conversationIds, mode: 'reconcile', instanceId });
      githubDetachedRun = run;
      void run
        .finally(() => {
          if (githubDetachedRun === run) githubDetachedRun = null;
        })
        .catch(() => {});
      return router.ok({ started: true, provider: 'github' });
    } catch (error) {
      releaseLock();
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(GITHUB_MESSAGE_TYPES.GET_SYNC_STATUS, async () => {
    try {
      const data: any = await deps.githubSyncOrchestrator.getSyncStatus();
      return router.ok({ ...data, active: Boolean(githubDetachedRun) || deps.githubSyncOrchestrator.isRunActive() });
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
