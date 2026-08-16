import { describe, expect, it } from 'vitest';
import { registerObsidianSettingsHandlers } from '@services/sync/obsidian/settings-background-handlers';
import { registerSyncHandlers } from '@services/sync/background-handlers';
import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { FactsOperationGate, assertFactsOperationLease } from '@services/local-data/facts-operation-gate';
import { LocalDataContractError } from '@services/local-data/contracts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const FACTS_EPOCH = 'idb-v1';

function stableReference(id: number) {
  return { source: 'test', conversationKey: `conversation-${id}` } as const;
}

function syncMessage(ids: number[], forceFullIds: number[] = []) {
  const forceFull = new Set(forceFullIds);
  return {
    type: 'obsidianSyncConversations',
    factsEpoch: FACTS_EPOCH,
    conversations: ids.map(stableReference),
    ...(forceFull.size ? { forceFullConversations: forceFullIds.map(stableReference) } : {}),
  };
}

describe('background-router obsidian sync routes', () => {
  it('delegates settings get/save and orchestrator actions', async () => {
    const calls: any = {
      testConnection: 0,
      syncPreflight: 0,
      syncPreflightMode: 'ok',
      getSyncStatus: 0,
      syncConversations: null,
      syncMode: 'success',
    };

    const store: Record<string, unknown> = {};
    const syncBlocker = deferred<any>();

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      storage: {
        local: {
          get(keys: any, cb: (res: Record<string, unknown>) => void) {
            const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
            const out: Record<string, unknown> = {};
            for (const k of list) out[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
            cb(out);
          },
          set(payload: Record<string, unknown>, cb: () => void) {
            for (const [k, v] of Object.entries(payload || {})) store[k] = v;
            cb && cb();
          },
        },
      },
    };

    const instanceId = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const router = createBackgroundRouter({
      fallback: (msg: any) => ({
        ok: false,
        data: null,
        error: { message: `unknown message type: ${msg?.type}`, extra: null },
      }),
    });

    registerObsidianSettingsHandlers(router as any, {
      getInstanceId: () => instanceId,
      testObsidianConnection: async ({ instanceId }: any) => {
        calls.testConnection += 1;
        return { ok: true, instanceId };
      },
    });
    const factsGate = new FactsOperationGate();
    factsGate.reopenForJournalState({ mode: 'not_started', journal: null, factsEpoch: FACTS_EPOCH, error: null });
    registerSyncHandlers(router as any, {
      getInstanceId: () => instanceId,
      factsOperations: factsGate,
      resolveConversationReferences: async (epoch: string, references: any[], lease: any) => {
        assertFactsOperationLease(lease);
        if (epoch !== FACTS_EPOCH) throw new LocalDataContractError('STALE_BACKEND_EPOCH');
        return references.map((reference) => {
          const match = /^conversation-(\d+)$/.exec(String(reference?.conversationKey || ''));
          const conversationId = Number(match?.[1]);
          if (reference?.source !== 'test' || !Number.isSafeInteger(conversationId) || conversationId <= 0) {
            throw new LocalDataContractError('STALE_REFERENCE');
          }
          return { source: 'test', conversationKey: reference.conversationKey, conversationId };
        });
      },
      notionSyncOrchestrator: {
        syncConversations: async () => ({ okCount: 0, failCount: 0, results: [] }),
        getSyncJobStatus: async () => ({ job: null }),
        clearSyncJobStatus: async () => ({ job: null }),
      },
      obsidianSyncOrchestrator: {
        async testConnection({ instanceId }: any) {
          calls.syncPreflight += 1;
          if (calls.syncPreflightMode === 'network_error') {
            return { ok: false, error: { code: 'network_error', message: 'Failed to fetch' }, instanceId };
          }
          return { ok: true, instanceId };
        },
        async getSyncStatus({ instanceId }: any) {
          calls.getSyncStatus += 1;
          return { job: null, instanceId };
        },
        async clearSyncStatus({ instanceId }: any) {
          return { job: null, instanceId };
        },
        async syncConversations(payload: any) {
          calls.syncConversations = payload;
          if (calls.syncMode === 'long-running') {
            return await syncBlocker.promise;
          }
          return { okCount: 1, failCount: 0, results: [{ conversationId: 1, ok: true }], payload };
        },
      },
      feishuSyncOrchestrator: {
        getSyncStatus: async () => ({ job: null }),
        clearSyncStatus: async () => ({ job: null }),
        syncConversations: async () => ({ okCount: 0, failCount: 0, results: [] }),
      },
    });

    store['webclipper_sync_provider_obsidian_enabled'] = false;
    const disabledRes = await router.__handleMessageForTests(syncMessage([1]));
    expect(disabledRes.ok).toBe(false);
    expect(disabledRes.error?.message).toBe('sync provider disabled');
    expect(disabledRes.error?.extra?.code).toBe('sync_provider_disabled');
    expect(disabledRes.error?.extra?.provider).toBe('obsidian');
    expect(calls.syncConversations).toBe(null);
    delete store['webclipper_sync_provider_obsidian_enabled'];

    const getRes = await router.__handleMessageForTests({ type: 'obsidianGetSettings' });
    expect(getRes.ok).toBe(true);
    expect(getRes.data?.apiBaseUrl).toContain('http://127.0.0.1:27123');
    expect(getRes.data?.apiKeyPresent).toBe(false);

    const saveRes = await router.__handleMessageForTests({
      type: 'obsidianSaveSettings',
      apiBaseUrl: 'http://127.0.0.1:27123',
      apiKey: 'k',
      authHeaderName: 'Authorization',
    });
    expect(saveRes.ok).toBe(true);
    expect(saveRes.data?.apiKeyPresent).toBe(true);
    expect(saveRes.data?.apiKeyMasked).toBe('********************************');

    const testRes = await router.__handleMessageForTests({ type: 'obsidianTestConnection' });
    expect(testRes.ok).toBe(true);
    expect(calls.testConnection).toBe(1);
    expect(typeof testRes.data?.instanceId).toBe('string');

    const statusRes = await router.__handleMessageForTests({ type: 'obsidianGetSyncStatus' });
    expect(statusRes.ok).toBe(true);
    expect(calls.getSyncStatus).toBe(1);
    expect(typeof statusRes.data?.instanceId).toBe('string');

    const syncRes = await router.__handleMessageForTests(syncMessage([1, 2], [2]));
    expect(syncRes.ok).toBe(true);
    expect(syncRes.data?.started).toBe(true);
    expect(calls.syncConversations?.conversations).toEqual([
      { source: 'test', conversationKey: 'conversation-1', conversationId: 1 },
      { source: 'test', conversationKey: 'conversation-2', conversationId: 2 },
    ]);
    expect(calls.syncConversations?.forceFullConversations).toEqual([
      { source: 'test', conversationKey: 'conversation-2', conversationId: 2 },
    ]);
    expect(typeof calls.syncConversations?.instanceId).toBe('string');

    calls.syncConversations = null;
    calls.syncPreflightMode = 'network_error';
    const preflightFailRes = await router.__handleMessageForTests(syncMessage([3]));
    expect(preflightFailRes.ok).toBe(false);
    expect(String(preflightFailRes.error?.message || '')).toContain('Open Obsidian');
    expect(String(preflightFailRes.error?.message || '')).toContain('Failed to fetch');
    expect(preflightFailRes.error?.extra?.provider).toBe('obsidian');
    expect(preflightFailRes.error?.extra?.stage).toBe('preflight');
    expect(preflightFailRes.error?.extra?.code).toBe('network_error');
    expect(calls.syncConversations).toBe(null);
    calls.syncPreflightMode = 'ok';

    calls.syncMode = 'long-running';
    const firstRun = router.__handleMessageForTests(syncMessage([1]));
    expect((await firstRun).ok).toBe(true);

    const conflictRes = await router.__handleMessageForTests(syncMessage([1]));
    expect(conflictRes.ok).toBe(false);
    expect(conflictRes.error?.message).toBe('sync already in progress');
    expect(conflictRes.error?.extra?.code).toBe('sync_already_running');

    syncBlocker.resolve({
      okCount: 1,
      failCount: 0,
      results: [{ conversationId: 1, ok: true }],
      payload: calls.syncConversations,
    });
  });
});
