import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFeishuAutoSyncScheduler } from '@services/sync/auto-sync/feishu-auto-sync-scheduler';
import {
  FEISHU_AUTO_SYNC_DEBOUNCE_MS,
  FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
  FEISHU_AUTO_SYNC_QUEUE_STORAGE_KEY,
  OBSIDIAN_AUTO_SYNC_DEBOUNCE_MS,
  OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
  OBSIDIAN_AUTO_SYNC_QUEUE_STORAGE_KEY,
} from '@services/sync/auto-sync/auto-sync-keys';
import { createObsidianAutoSyncScheduler } from '@services/sync/auto-sync/obsidian-auto-sync-scheduler';

const storageState: Record<string, any> = {};

const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

const gateMocks = vi.hoisted(() => ({
  isSyncProviderEnabled: vi.fn(),
}));

const alarmMocks = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  create: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.get,
  storageSet: storageMocks.set,
}));

vi.mock('@services/sync/sync-provider-gate', () => ({
  isSyncProviderEnabled: gateMocks.isSyncProviderEnabled,
}));

vi.mock('@platform/alarms/alarms', () => ({
  isAlarmsAvailable: alarmMocks.isAvailable,
  create: alarmMocks.create,
  clear: alarmMocks.clear,
}));

beforeEach(() => {
  for (const key of Object.keys(storageState)) delete storageState[key];
  storageMocks.get.mockImplementation(async (keys: string[]) => {
    const result: Record<string, unknown> = {};
    for (const key of keys) result[key] = storageState[key];
    return result;
  });
  storageMocks.set.mockImplementation(async (patch: Record<string, unknown>) => {
    Object.assign(storageState, patch);
  });
  gateMocks.isSyncProviderEnabled.mockResolvedValue(true);
  alarmMocks.isAvailable.mockReturnValue(false);
  alarmMocks.create.mockReset();
  alarmMocks.clear.mockResolvedValue(true);
});

describe('provider auto-sync job persistence retry', () => {
  it.each([
    {
      provider: 'obsidian',
      enabledKey: OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY,
      queueKey: OBSIDIAN_AUTO_SYNC_QUEUE_STORAGE_KEY,
      debounceMs: OBSIDIAN_AUTO_SYNC_DEBOUNCE_MS,
      errorCode: 'obsidian_sync_job_persist_failed',
      createScheduler: (syncConversations: ReturnType<typeof vi.fn>, now: number) =>
        createObsidianAutoSyncScheduler(
          {
            getInstanceId: () => 'instance-obsidian',
            obsidianSyncOrchestrator: { syncConversations } as any,
          },
          { now: () => now },
        ),
    },
    {
      provider: 'feishu',
      enabledKey: FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY,
      queueKey: FEISHU_AUTO_SYNC_QUEUE_STORAGE_KEY,
      debounceMs: FEISHU_AUTO_SYNC_DEBOUNCE_MS,
      errorCode: 'feishu_sync_job_persist_failed',
      createScheduler: (syncConversations: ReturnType<typeof vi.fn>, now: number) =>
        createFeishuAutoSyncScheduler(
          {
            getInstanceId: () => 'instance-feishu',
            feishuSyncOrchestrator: { syncConversations } as any,
          },
          { now: () => now },
        ),
    },
  ] as const)('requeues $provider initial SyncJob persistence failure with the existing debounce', async (entry) => {
    const now = 10_000;
    const syncConversations = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('persist failed'), { code: entry.errorCode }));
    storageState[entry.enabledKey] = true;
    storageState[entry.queueKey] = { '7': now - 1 };

    await entry.createScheduler(syncConversations, now).flush();

    expect(syncConversations).toHaveBeenCalledTimes(1);
    expect(storageState[entry.queueKey]).toEqual({ '7': now + entry.debounceMs });
  });
});
