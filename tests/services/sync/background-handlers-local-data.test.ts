import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureSyncProviderEnabled: vi.fn(async () => null),
  getNotionOAuthToken: vi.fn(async () => ({ accessToken: 'notion-token' })),
  getFeishuOAuthToken: vi.fn(async () => ({ accessToken: 'feishu-token' })),
  storageGet: vi.fn(async () => ({ notion_parent_page_id: 'parent-page' })),
}));

vi.mock('@services/sync/sync-provider-gate', () => ({ ensureSyncProviderEnabled: mocks.ensureSyncProviderEnabled }));
vi.mock('@services/sync/notion/auth/token-store', () => ({ getNotionOAuthToken: mocks.getNotionOAuthToken }));
vi.mock('@services/sync/feishu/auth/token-store', () => ({ getFeishuOAuthToken: mocks.getFeishuOAuthToken }));
vi.mock('@platform/storage/local', () => ({ storageGet: mocks.storageGet }));

import { registerSyncHandlers } from '@services/sync/background-handlers';
import { FactsOperationGate, assertFactsOperationLease } from '@services/local-data/facts-operation-gate';
import { LocalDataContractError } from '@services/local-data/contracts';
import { NOTION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function router() {
  const handlers = new Map<string, (message: any) => Promise<any> | any>();
  return {
    handlers,
    register: (type: string, handler: (message: any) => Promise<any> | any) => handlers.set(type, handler),
    ok: (data: unknown) => ({ ok: true, data, error: null }),
    err: (message: string, extra?: unknown) => ({ ok: false, data: null, error: { message, extra: extra ?? null } }),
    eventsHub: { broadcast: vi.fn() },
  };
}

function deps(gate: FactsOperationGate, syncConversations = vi.fn(async () => ({}))) {
  const resolved = { source: 'chatgpt', conversationKey: 'thread-1', conversationId: 41 } as const;
  return {
    syncConversations,
    value: {
      getInstanceId: () => 'background-1',
      factsOperations: gate,
      resolveConversationReferences: vi.fn(async (epoch: string, refs: any[], lease: any) => {
        assertFactsOperationLease(lease);
        if (epoch !== 'idb-v1') throw new LocalDataContractError('STALE_BACKEND_EPOCH');
        if (refs[0]?.source !== resolved.source || refs[0]?.conversationKey !== resolved.conversationKey) {
          throw new LocalDataContractError('STALE_REFERENCE');
        }
        return [resolved];
      }),
      notionSyncOrchestrator: {
        getSyncJobStatus: vi.fn(async () => ({ job: null })),
        clearSyncJobStatus: vi.fn(async () => ({ job: null })),
        syncConversations,
      },
      obsidianSyncOrchestrator: {
        getSyncStatus: vi.fn(async () => ({ job: null })),
        clearSyncStatus: vi.fn(async () => ({ job: null })),
        testConnection: vi.fn(async () => ({ ok: true })),
        syncConversations: vi.fn(async () => ({})),
      },
      feishuSyncOrchestrator: {
        getSyncStatus: vi.fn(async () => ({ job: null })),
        clearSyncStatus: vi.fn(async () => ({ job: null })),
        syncConversations: vi.fn(async () => ({})),
      },
    },
  };
}

function manualMessage(factsEpoch = 'idb-v1') {
  return {
    type: NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS,
    factsEpoch,
    conversations: [{ source: 'chatgpt', conversationKey: 'thread-1' }],
  };
}

describe('sync background facts boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a stale manual epoch before the provider can perform a remote side effect', async () => {
    const gate = new FactsOperationGate();
    gate.reopenForJournalState({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null });
    const pack = deps(gate);
    const r = router();
    registerSyncHandlers(r as any, pack.value as any);

    const response = await r.handlers.get(NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS)!(manualMessage('old-epoch'));

    expect(response).toMatchObject({ ok: false, error: { extra: { code: 'STALE_BACKEND_EPOCH' } } });
    expect(pack.syncConversations).not.toHaveBeenCalled();
    expect(r.eventsHub.broadcast).not.toHaveBeenCalled();
  });

  it('keeps the detached provider run inside the admitted lease after returning started', async () => {
    const gate = new FactsOperationGate();
    gate.reopenForJournalState({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null });
    const remote = deferred();
    const syncConversations = vi.fn(async () => {
      await remote.promise;
      return { okCount: 1 };
    });
    const pack = deps(gate, syncConversations);
    const r = router();
    registerSyncHandlers(r as any, pack.value as any);

    const response = await r.handlers.get(NOTION_MESSAGE_TYPES.SYNC_CONVERSATIONS)!(manualMessage());
    expect(response).toMatchObject({ ok: true, data: { started: true, provider: 'notion' } });

    gate.closeAdmissions();
    let drained = false;
    const drain = gate.waitForDrained().then(() => (drained = true));
    await Promise.resolve();
    expect(drained).toBe(false);

    remote.resolve();
    await drain;
    expect(drained).toBe(true);
    expect(syncConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        conversations: [{ source: 'chatgpt', conversationKey: 'thread-1', conversationId: 41 }],
        instanceId: 'background-1',
        lease: expect.any(Object),
      }),
    );
  });
});
