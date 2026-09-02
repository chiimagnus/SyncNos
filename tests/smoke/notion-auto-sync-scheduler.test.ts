import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNotionAutoSyncScheduler } from '@services/sync/auto-sync/notion-auto-sync-scheduler';
import {
  NOTION_AUTO_SYNC_DEBOUNCE_MS,
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

const alarmsMocks = vi.hoisted(() => ({
  isAlarmsAvailable: vi.fn(),
  create: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.storageGet,
  storageSet: storageMocks.storageSet,
}));

vi.mock('@services/sync/sync-provider-gate', () => ({
  isSyncProviderEnabled: gateMocks.isSyncProviderEnabled,
}));

vi.mock('@platform/alarms/alarms', () => ({
  isAlarmsAvailable: alarmsMocks.isAlarmsAvailable,
  create: alarmsMocks.create,
  clear: alarmsMocks.clear,
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
  alarmsMocks.isAlarmsAvailable.mockReturnValue(false);
  alarmsMocks.create.mockReset();
  alarmsMocks.clear.mockResolvedValue(true);
});

describe('notion-auto-sync-scheduler', () => {
  it('enqueues and flushes due conversations via orchestrator', async () => {
    const syncConversations = vi.fn().mockResolvedValue({});
    setStoragePatch({
      [NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY]: true,
      notion_parent_page_id: 'parent',
    });

    const scheduler = createNotionAutoSyncScheduler({
      getInstanceId: () => 'instance-1',
      notionSyncOrchestrator: {
        syncConversations,
        getSyncJobStatus: async () => ({}),
        clearSyncJobStatus: async () => ({}),
      } as any,
    });

    await scheduler.enqueue(123, 'syncConversationMessages');
    const queue = storageState[NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY];
    expect(queue).toBeTruthy();

    // force due
    storageState[NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY] = { '123': Date.now() - 1 };
    await scheduler.flush();

    expect(syncConversations).toHaveBeenCalledWith({ conversationIds: [123], instanceId: 'instance-1' });
  });

  it('requeues a transient initial job persistence failure using the existing debounce', async () => {
    const now = Date.now();
    const syncConversations = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('persist failed'), { code: 'notion_sync_job_persist_failed' }));
    setStoragePatch({
      [NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY]: true,
      [NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY]: { '7': now - 1 },
    });

    const scheduler = createNotionAutoSyncScheduler(
      {
        getInstanceId: () => 'instance-persist',
        notionSyncOrchestrator: { syncConversations } as any,
      },
      { now: () => now },
    );

    await scheduler.flush();

    expect(storageState[NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({ '7': now + NOTION_AUTO_SYNC_DEBOUNCE_MS });
  });

  it('requeues a synchronous ownership conflict through the real Notion adapter', async () => {
    const now = Date.now();
    const syncConversations = vi.fn(() => {
      throw Object.assign(new Error('sync already in progress'), { code: 'sync_already_running' });
    });
    setStoragePatch({
      [NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY]: true,
      [NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY]: { '8': now - 1 },
    });

    const scheduler = createNotionAutoSyncScheduler(
      {
        getInstanceId: () => 'instance-busy',
        notionSyncOrchestrator: { syncConversations } as any,
      },
      { now: () => now },
    );

    await scheduler.flush();

    expect(syncConversations).toHaveBeenCalledWith({ conversationIds: [8], instanceId: 'instance-busy' });
    expect(storageState[NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({ '8': now + NOTION_AUTO_SYNC_DEBOUNCE_MS });
  });

  it('delegates ordinary failed runs to the orchestrator and keeps the existing consume-on-failure semantics', async () => {
    const syncConversations = vi.fn().mockRejectedValue(new Error('notion not connected'));
    setStoragePatch({
      [NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY]: true,
      [NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY]: { '7': Date.now() - 1 },
    });

    const scheduler = createNotionAutoSyncScheduler({
      getInstanceId: () => 'instance-2',
      notionSyncOrchestrator: {
        syncConversations,
        getSyncJobStatus: async () => ({}),
        clearSyncJobStatus: async () => ({}),
      } as any,
    });

    await scheduler.flush();

    expect(syncConversations).toHaveBeenCalledWith({ conversationIds: [7], instanceId: 'instance-2' });
    expect(storageState[NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({});
  });
});
