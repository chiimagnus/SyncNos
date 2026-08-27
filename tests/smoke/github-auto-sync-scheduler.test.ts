import {
  GITHUB_AUTO_SYNC_ACTION_REQUIRED_RETRY_MS,
  GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS,
  createGithubAutoSyncScheduler,
  getGithubAutoSyncFailureRetryDelayMs,
} from '@services/sync/auto-sync/github-auto-sync-scheduler';
import {
  GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
  GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY,
} from '@services/sync/auto-sync/auto-sync-keys';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageState: Record<string, any> = {};
const storageMocks = vi.hoisted(() => ({ storageGet: vi.fn(), storageSet: vi.fn() }));
const gateMocks = vi.hoisted(() => ({ isSyncProviderEnabled: vi.fn() }));
const alarmsMocks = vi.hoisted(() => ({ isAlarmsAvailable: vi.fn(), create: vi.fn(), clear: vi.fn() }));

vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.storageGet,
  storageSet: storageMocks.storageSet,
}));
vi.mock('@services/sync/sync-provider-gate', () => ({ isSyncProviderEnabled: gateMocks.isSyncProviderEnabled }));
vi.mock('@platform/alarms/alarms', () => ({
  isAlarmsAvailable: alarmsMocks.isAlarmsAvailable,
  create: alarmsMocks.create,
  clear: alarmsMocks.clear,
}));

beforeEach(() => {
  for (const key of Object.keys(storageState)) delete storageState[key];
  storageMocks.storageGet.mockImplementation(async (keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, storageState[key]])),
  );
  storageMocks.storageSet.mockImplementation(async (patch: Record<string, unknown>) => Object.assign(storageState, patch));
  gateMocks.isSyncProviderEnabled.mockResolvedValue(true);
  alarmsMocks.isAlarmsAvailable.mockReturnValue(true);
  alarmsMocks.create.mockReset();
  alarmsMocks.clear.mockResolvedValue(true);
});

describe('github-auto-sync-scheduler', () => {
  it('runs queued conversations through incremental GitHub sync', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    const sync = vi.fn().mockResolvedValue({ transport: { status: 'not_needed' }, items: [] });
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-auto-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.enqueue(7, 'syncConversationMessages');
    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({ '7': 70_000 });

    storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY] = { '7': 9_999 };
    await scheduler.flush();

    expect(sync).toHaveBeenCalledWith({ conversationIds: [7], mode: 'incremental', instanceId: 'github-auto-instance' });
    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({});
  });

  it('retains dirty ids after an auth/preflight failure instead of dropping them', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY] = { '7': 9_999 };
    const error = Object.assign(new Error('github_auth_required'), { code: 'github_auth_required' });
    const sync = vi.fn().mockRejectedValue(error);
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-auto-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.flush();

    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({
      '7': 10_000 + GITHUB_AUTO_SYNC_ACTION_REQUIRED_RETRY_MS,
    });
  });

  it('retains dirty ids when the orchestrator reports a recoverable transport failure', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY] = { '8': 9_999 };
    const sync = vi.fn().mockResolvedValue({
      transport: { status: 'failed' },
      items: [{ conversationId: 8, status: 'failed', error: 'github_network_error' }],
    });
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-auto-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.flush();

    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({
      '8': 10_000 + GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS,
    });
  });

  it('classifies safe GitHub failures without retrying unrelated errors', () => {
    expect(getGithubAutoSyncFailureRetryDelayMs({ code: 'github_timeout' })).toBe(GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS);
    expect(getGithubAutoSyncFailureRetryDelayMs({ code: 'github_auth_required' })).toBe(
      GITHUB_AUTO_SYNC_ACTION_REQUIRED_RETRY_MS,
    );
    expect(getGithubAutoSyncFailureRetryDelayMs(new Error('local failure'))).toBeUndefined();
  });
});
