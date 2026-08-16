import {
  FEISHU_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
  UI_EVENT_TYPES,
} from '@platform/messaging/message-contracts';
import { storageGet } from '@platform/storage/local';
import { getNotionOAuthToken } from '@services/sync/notion/auth/token-store';
import { getFeishuOAuthToken } from '@services/sync/feishu/auth/token-store';
import { ensureSyncProviderEnabled } from '@services/sync/sync-provider-gate';
import type { ResolvedConversationReference } from '@services/conversations/data/storage-native';
import {
  LocalDataContractError,
  type FactsEpoch,
  type StableConversationReference,
} from '@services/local-data/contracts';
import type { FactsOperationLease } from '@services/local-data/facts-operation-gate';
import type {
  FactsOperationRunner,
  FeishuSyncOrchestrator,
  NotionSyncOrchestrator,
  ObsidianSyncOrchestrator,
} from '@services/bootstrap/background-services';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
  eventsHub?: { broadcast: (type: string, payload: unknown) => void };
};

type Deps = {
  getInstanceId: () => string;
  factsOperations: FactsOperationRunner;
  notionSyncOrchestrator: NotionSyncOrchestrator;
  obsidianSyncOrchestrator: ObsidianSyncOrchestrator;
  feishuSyncOrchestrator: FeishuSyncOrchestrator;
  resolveConversationReferences: (
    expectedFactsEpoch: string,
    references: readonly StableConversationReference[],
    lease: FactsOperationLease,
  ) => Promise<ResolvedConversationReference[]>;
};

let notionDetachedRun: Promise<unknown> | null = null;
let obsidianDetachedRun: Promise<unknown> | null = null;
let feishuDetachedRun: Promise<unknown> | null = null;

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
  const message =
    `Obsidian connection test failed. Open Obsidian and ensure the Local REST API plugin is enabled. If this persists, check Settings -> Obsidian Local REST API (Base URL / API Key). Details: ${detail}`.trim();
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

function parseFactsEpoch(value: unknown): FactsEpoch {
  const factsEpoch = String(value || '').trim();
  if (!factsEpoch) throw new LocalDataContractError('STALE_BACKEND_EPOCH');
  return factsEpoch as FactsEpoch;
}

function parseReference(value: unknown): StableConversationReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value as object, 'conversationId')) {
    return null;
  }
  const source = String((value as any).source || '').trim();
  const conversationKey = String((value as any).conversationKey || '').trim();
  return source && conversationKey ? { source, conversationKey } : null;
}

function parseReferences(value: unknown): StableConversationReference[] {
  if (!Array.isArray(value) || !value.length) throw new LocalDataContractError('INVALID_ARGUMENT');
  const out: StableConversationReference[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const reference = parseReference(item);
    if (!reference) throw new LocalDataContractError('INVALID_ARGUMENT');
    const key = `${reference.source}\u0000${reference.conversationKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reference);
  }
  if (!out.length) throw new LocalDataContractError('INVALID_ARGUMENT');
  return out;
}

function deferredValidation() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function registerSyncHandlers(router: AnyRouter, deps: Deps) {
  router.register(NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    if (notionDetachedRun) return router.err('sync already in progress', { code: 'sync_already_running' });
    try {
      const gateError = await ensureSyncProviderEnabled('notion');
      if (gateError) return router.err('sync provider disabled', gateError);
      const factsEpoch = parseFactsEpoch(msg?.factsEpoch);
      const references = parseReferences(msg?.conversations);
      const instanceId = deps.getInstanceId();
      const status = await deps.notionSyncOrchestrator.getSyncJobStatus({ instanceId });
      if ((status as any)?.job?.status === 'running') {
        return router.err('sync already in progress', { code: 'sync_already_running' });
      }
      const token = await getNotionOAuthToken().catch(() => null);
      if (!token?.accessToken) return router.err('notion not connected');
      const local = await storageGet(['notion_parent_page_id']).catch(() => ({}));
      if (!String((local as any)?.notion_parent_page_id || '').trim()) return router.err('missing parentPageId');

      const validation = deferredValidation();
      const run = deps.factsOperations.runFactsOperation('notion-manual-sync', async (lease) => {
        try {
          const conversations = await deps.resolveConversationReferences(factsEpoch, references, lease);
          validation.resolve();
          const result = await deps.notionSyncOrchestrator.syncConversations({ conversations, instanceId, lease });
          router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
            reason: 'syncFinished',
            provider: 'notion',
          });
          return result;
        } catch (error) {
          validation.reject(error);
          throw error;
        }
      });
      notionDetachedRun = run;
      void run
        .finally(() => {
          if (notionDetachedRun === run) notionDetachedRun = null;
        })
        .catch(() => {});
      await validation.promise;
      return router.ok({ started: true, provider: 'notion' });
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
    if (obsidianDetachedRun) return router.err('sync already in progress', { code: 'sync_already_running' });
    try {
      const gateError = await ensureSyncProviderEnabled('obsidian');
      if (gateError) return router.err('sync provider disabled', gateError);
      const factsEpoch = parseFactsEpoch(msg?.factsEpoch);
      const references = parseReferences(msg?.conversations);
      const forceFullReferences =
        msg?.forceFullConversations == null ? [] : parseReferences(msg.forceFullConversations);
      const requestedKeys = new Set(
        references.map((reference) => `${reference.source}\u0000${reference.conversationKey}`),
      );
      if (
        forceFullReferences.some(
          (reference) => !requestedKeys.has(`${reference.source}\u0000${reference.conversationKey}`),
        )
      ) {
        throw new LocalDataContractError('INVALID_ARGUMENT');
      }
      const instanceId = deps.getInstanceId();
      const status = await deps.obsidianSyncOrchestrator.getSyncStatus({ instanceId });
      if ((status as any)?.job?.status === 'running') {
        return router.err('sync already in progress', { code: 'sync_already_running' });
      }
      const preflight = await deps.obsidianSyncOrchestrator.testConnection({ instanceId }).catch((error: any) => ({
        ok: false,
        error: { code: 'network_error', message: error?.message ? String(error.message) : 'connection test failed' },
      }));
      if (!preflight || (preflight as any).ok !== true) {
        const failure = buildObsidianPreflightFailure(preflight);
        return router.err(failure.message, failure.extra);
      }

      const validation = deferredValidation();
      const run = deps.factsOperations.runFactsOperation('obsidian-manual-sync', async (lease) => {
        try {
          const conversations = await deps.resolveConversationReferences(factsEpoch, references, lease);
          const forceFullConversations = forceFullReferences.length
            ? await deps.resolveConversationReferences(factsEpoch, forceFullReferences, lease)
            : [];
          validation.resolve();
          const result = await deps.obsidianSyncOrchestrator.syncConversations({
            conversations,
            ...(forceFullConversations.length ? { forceFullConversations } : {}),
            instanceId,
            lease,
          });
          router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
            reason: 'syncFinished',
            provider: 'obsidian',
          });
          return result;
        } catch (error) {
          validation.reject(error);
          throw error;
        }
      });
      obsidianDetachedRun = run;
      void run
        .finally(() => {
          if (obsidianDetachedRun === run) obsidianDetachedRun = null;
        })
        .catch(() => {});
      await validation.promise;
      return router.ok({ started: true, provider: 'obsidian' });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(FEISHU_MESSAGE_TYPES.SYNC_CONVERSATIONS, async (msg) => {
    if (feishuDetachedRun) return router.err('sync already in progress', { code: 'sync_already_running' });
    try {
      const gateError = await ensureSyncProviderEnabled('feishu');
      if (gateError) return router.err('sync provider disabled', gateError);
      const factsEpoch = parseFactsEpoch(msg?.factsEpoch);
      const references = parseReferences(msg?.conversations);
      const instanceId = deps.getInstanceId();
      const status = await deps.feishuSyncOrchestrator.getSyncStatus({ instanceId });
      if ((status as any)?.job?.status === 'running') {
        return router.err('sync already in progress', { code: 'sync_already_running' });
      }
      const token = await getFeishuOAuthToken().catch(() => null);
      if (!token?.accessToken) return router.err('feishu not connected');

      const validation = deferredValidation();
      const run = deps.factsOperations.runFactsOperation('feishu-manual-sync', async (lease) => {
        try {
          const conversations = await deps.resolveConversationReferences(factsEpoch, references, lease);
          validation.resolve();
          const result = await deps.feishuSyncOrchestrator.syncConversations({ conversations, instanceId, lease });
          router.eventsHub?.broadcast(UI_EVENT_TYPES.CONVERSATIONS_CHANGED, {
            reason: 'syncFinished',
            provider: 'feishu',
          });
          return result;
        } catch (error) {
          validation.reject(error);
          throw error;
        }
      });
      feishuDetachedRun = run;
      void run
        .finally(() => {
          if (feishuDetachedRun === run) feishuDetachedRun = null;
        })
        .catch(() => {});
      await validation.promise;
      return router.ok({ started: true, provider: 'feishu' });
    } catch (error) {
      return toSyncErrorResponse(router, error);
    }
  });

  router.register(FEISHU_MESSAGE_TYPES.GET_SYNC_STATUS, async () => {
    const data = await deps.feishuSyncOrchestrator.getSyncStatus({ instanceId: deps.getInstanceId() });
    return router.ok(data);
  });

  router.register(FEISHU_MESSAGE_TYPES.CLEAR_SYNC_STATUS, async () => {
    const data = await deps.feishuSyncOrchestrator.clearSyncStatus({ instanceId: deps.getInstanceId() });
    return router.ok(data);
  });
}
