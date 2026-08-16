import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNotionAutoSyncScheduler } from '@services/sync/auto-sync/notion-auto-sync-scheduler';
import { FactsOperationGate } from '@services/local-data/facts-operation-gate';
import {
  NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY,
  NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY,
} from '@services/sync/auto-sync/auto-sync-keys';

const storageState: Record<string, any> = {};

const storageMocks = vi.hoisted(() => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
}));

const gateMocks = vi.hoisted(() => ({
  isSyncProviderEnabled: vi.fn(),
}));

const tokenStoreMocks = vi.hoisted(() => ({
  getNotionOAuthToken: vi.fn(),
}));

const alarmsMocks = vi.hoisted(() => ({
  isAlarmsAvailable: vi.fn(),
  create: vi.fn(),
  clear: vi.fn(),
}));

const jobStoreMocks = vi.hoisted(() => ({
  setJob: vi.fn(),
}));

vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.storageGet,
  storageSet: storageMocks.storageSet,
}));

vi.mock('@services/sync/sync-provider-gate', () => ({
  isSyncProviderEnabled: gateMocks.isSyncProviderEnabled,
}));

vi.mock('@services/sync/notion/auth/token-store', () => ({
  getNotionOAuthToken: tokenStoreMocks.getNotionOAuthToken,
}));

vi.mock('@platform/alarms/alarms', () => ({
  isAlarmsAvailable: alarmsMocks.isAlarmsAvailable,
  create: alarmsMocks.create,
  clear: alarmsMocks.clear,
}));

vi.mock('@services/sync/notion/notion-sync-job-store', () => ({
  default: {
    setJob: jobStoreMocks.setJob,
  },
}));

function setStoragePatch(patch: Record<string, any>) {
  for (const [k, v] of Object.entries(patch)) storageState[k] = v;
}

beforeEach(() => {
  for (const key of Object.keys(storageState)) delete storageState[key];
  storageMocks.storageGet.mockImplementation(async (keys: string[]) => {
    const out: Record<string, any> = {};
    for (const key of keys) out[key] = storageState[key];
    return out;
  });
  storageMocks.storageSet.mockImplementation(async (patch: Record<string, any>) => {
    setStoragePatch(patch);
  });

  gateMocks.isSyncProviderEnabled.mockResolvedValue(true);
  tokenStoreMocks.getNotionOAuthToken.mockResolvedValue({
    accessToken: 'token',
    workspaceId: 'w',
    workspaceName: 'W',
    createdAt: Date.now(),
  });
  alarmsMocks.isAlarmsAvailable.mockReturnValue(true);
  alarmsMocks.create.mockReset();
  alarmsMocks.clear.mockResolvedValue(true);
  jobStoreMocks.setJob.mockResolvedValue(true);
});

describe('notion-auto-sync-scheduler', () => {
  it('enqueues and flushes due conversations via orchestrator', async () => {
    const syncConversations = vi.fn().mockResolvedValue({});
    setStoragePatch({
      [NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY]: true,
      notion_parent_page_id: 'parent',
    });

    const gate = new FactsOperationGate();
    gate.reopenForJournalState({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null });
    const scheduler = createNotionAutoSyncScheduler({
      getInstanceId: () => 'instance-1',
      runFactsOperation: gate.runFactsOperation.bind(gate),
      resolveConversationId: async () => 123,
      syncConversations,
    });

    await gate.runFactsOperation('enqueue', async (lease) => {
      await scheduler.enqueue({ source: 'chatgpt', conversationKey: 'thread-123' }, 'syncConversationMessages', lease);
    });
    const queue = storageState[NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY];
    expect(queue).toBeTruthy();

    // force due
    storageState[NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY] = {
      version: 2,
      entries: [{ source: 'chatgpt', conversationKey: 'thread-123', dueAt: Date.now() - 1 }],
    };
    await scheduler.flush();

    expect(syncConversations).toHaveBeenCalledWith(
      [{ source: 'chatgpt', conversationKey: 'thread-123', conversationId: 123, dueAt: expect.any(Number) }],
      'instance-1',
      expect.any(Object),
    );
  });

  it('writes a visible job failure when Notion is not connected', async () => {
    const syncConversations = vi.fn().mockResolvedValue({});
    tokenStoreMocks.getNotionOAuthToken.mockResolvedValue(null);
    setStoragePatch({
      [NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY]: true,
      notion_parent_page_id: 'parent',
      [NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY]: {
        version: 2,
        entries: [{ source: 'chatgpt', conversationKey: 'thread-7', dueAt: Date.now() - 1 }],
      },
    });

    const gate = new FactsOperationGate();
    gate.reopenForJournalState({ mode: 'not_started', journal: null, factsEpoch: 'idb-v1', error: null });
    const scheduler = createNotionAutoSyncScheduler({
      getInstanceId: () => 'instance-2',
      runFactsOperation: gate.runFactsOperation.bind(gate),
      resolveConversationId: async () => 7,
      syncConversations,
    });

    await scheduler.flush();
    expect(syncConversations).not.toHaveBeenCalled();
    expect(jobStoreMocks.setJob).toHaveBeenCalled();
    const jobArg = jobStoreMocks.setJob.mock.calls[0]?.[0];
    expect(jobArg?.provider).toBe('notion');
    expect(jobArg?.status).toBe('done');
    expect(jobArg?.failCount).toBe(1);
  });
});
