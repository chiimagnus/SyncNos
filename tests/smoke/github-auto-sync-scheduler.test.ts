import {
  GITHUB_AUTO_SYNC_ACTION_REQUIRED_RETRY_MS,
  GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS,
  GITHUB_CLEANUP_BATCH_CONTINUE_DELAY_MS,
  GITHUB_CLEANUP_BUSY_RETRY_MS,
  createGithubAutoSyncScheduler,
  getGithubAutoSyncFailureRetryDelayMs,
} from '@services/sync/auto-sync/github-auto-sync-scheduler';
import {
  GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME,
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
  storageMocks.storageSet.mockImplementation(async (patch: Record<string, unknown>) =>
    Object.assign(storageState, patch),
  );
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

    expect(sync).toHaveBeenCalledWith({
      conversationIds: [7],
      mode: 'incremental',
      instanceId: 'github-auto-instance',
    });
    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({});
  });

  it('retains dirty ids after an initial job persistence failure using the transient retry cadence', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY] = { '6': 9_999 };
    const sync = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('persist failed'), { code: 'github_sync_job_persist_failed' }));
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-auto-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.flush();

    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({
      '6': 10_000 + GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS,
    });
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

  it('retains dirty ids when projection reports an item-level GitHub network failure', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY] = { '9': 9_999 };
    const sync = vi.fn().mockResolvedValue({
      transport: { status: 'not_needed' },
      items: [{ conversationId: 9, status: 'failed', error: 'github_network_error' }],
    });
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-auto-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.flush();

    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({
      '9': 10_000 + GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS,
    });
  });

  it('retains dirty ids when an item-level local failure has no GitHub-specific error code', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY] = { '12': 9_999 };
    const sync = vi.fn().mockResolvedValue({
      transport: { status: 'not_needed' },
      items: [{ conversationId: 12, status: 'failed', error: 'conversation not found' }],
    });
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-auto-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.flush();

    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({
      '12': 10_000 + GITHUB_AUTO_SYNC_ACTION_REQUIRED_RETRY_MS,
    });
  });

  it('retains dirty ids when the orchestrator returns an invalid transport resolution', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY] = { '10': 9_999 };
    const sync = vi.fn().mockResolvedValue({
      transport: { status: 'invalid_resolution' },
      items: [{ conversationId: 10, status: 'failed', error: 'github_transport_resolution_incomplete' }],
    });
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-auto-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.flush();

    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({
      '10': 10_000 + GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS,
    });
  });

  it('retains dirty ids when local mapping acknowledgement fails after a GitHub commit', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY] = { '11': 9_999 };
    const sync = vi.fn().mockResolvedValue({
      transport: { status: 'committed' },
      items: [{ conversationId: 11, status: 'mapping_failed', error: 'github_mapping_patch_failed' }],
    });
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-auto-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.flush();

    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({
      '11': 10_000 + GITHUB_AUTO_SYNC_ACTION_REQUIRED_RETRY_MS,
    });
  });

  it('uses a bounded retry for both known GitHub failures and unknown local failures', () => {
    expect(getGithubAutoSyncFailureRetryDelayMs({ code: 'github_timeout' })).toBe(GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS);
    expect(getGithubAutoSyncFailureRetryDelayMs({ code: 'github_auth_required' })).toBe(
      GITHUB_AUTO_SYNC_ACTION_REQUIRED_RETRY_MS,
    );
    expect(getGithubAutoSyncFailureRetryDelayMs(new Error('local failure'))).toBe(
      GITHUB_AUTO_SYNC_ACTION_REQUIRED_RETRY_MS,
    );
  });

  it('schedules cleanup wake without resolving repository state or calling the orchestrator', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    const sync = vi.fn();
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-cleanup-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.scheduleCleanup(25_000);

    expect(sync).not.toHaveBeenCalled();
    expect(alarmsMocks.create).toHaveBeenCalledWith(GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME, { when: 25_000 });
  });

  it('drains cleanup-only work, re-dirties replacements, and schedules a future batch without recursion', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    const sync = vi.fn().mockResolvedValue({
      transport: { status: 'committed' },
      deferredReplacementConversationIds: [7, 7, '8', 0],
      cleanupHasMoreDue: true,
      nextCleanupDueAt: null,
    });
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-cleanup-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.flushCleanup();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith({
      conversationIds: [],
      mode: 'incremental',
      instanceId: 'github-cleanup-instance',
    });
    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({ '7': 70_000, '8': 70_000 });
    expect(alarmsMocks.create).toHaveBeenCalledWith(GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME, {
      when: 10_000 + GITHUB_CLEANUP_BATCH_CONTINUE_DELAY_MS,
    });
  });

  it('uses the orchestrator nextCleanupDueAt exactly when no cleanup batch remains due', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    const sync = vi.fn().mockResolvedValue({
      transport: { status: 'not_needed' },
      deferredReplacementConversationIds: [],
      cleanupHasMoreDue: false,
      nextCleanupDueAt: 45_678,
    });
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-cleanup-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.flushCleanup();

    expect(alarmsMocks.create).toHaveBeenCalledWith(GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME, { when: 45_678 });
  });

  it('reschedules cleanup with the transient cadence when cleanup-only job persistence fails', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    const sync = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('persist failed'), { code: 'github_sync_job_persist_failed' }));
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-cleanup-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.flushCleanup();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(alarmsMocks.create).toHaveBeenCalledWith(GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME, {
      when: 10_000 + GITHUB_AUTO_SYNC_TRANSIENT_RETRY_MS,
    });
  });

  it('reschedules cleanup in the future when the shared GitHub job is busy', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    const sync = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('sync already in progress'), { code: 'sync_already_running' }));
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-cleanup-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.flushCleanup();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(alarmsMocks.create).toHaveBeenCalledWith(GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME, {
      when: 10_000 + GITHUB_CLEANUP_BUSY_RETRY_MS,
    });
  });

  it('never runs cleanup when GitHub auto-sync is disabled', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = false;
    const sync = vi.fn();
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-cleanup-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.scheduleCleanup();
    await scheduler.flushCleanup();

    expect(sync).not.toHaveBeenCalled();
    expect(alarmsMocks.create).not.toHaveBeenCalled();
  });

  it('never runs cleanup when the GitHub provider gate is disabled', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    gateMocks.isSyncProviderEnabled.mockResolvedValue(false);
    const sync = vi.fn();
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'github-cleanup-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => 10_000 },
    );

    await scheduler.scheduleCleanup();
    await scheduler.flushCleanup();

    expect(sync).not.toHaveBeenCalled();
    expect(alarmsMocks.create).not.toHaveBeenCalled();
  });

  it('recovers an identity-move crash window by syncing the replacement before cleanup rechecks', async () => {
    storageState[GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY] = true;
    let now = 10_000;
    const sync = vi
      .fn()
      .mockResolvedValueOnce({
        transport: { status: 'not_needed' },
        deferredReplacementConversationIds: [7],
        cleanupHasMoreDue: false,
        nextCleanupDueAt: 75_000,
      })
      .mockResolvedValueOnce({ transport: { status: 'committed' }, items: [{ conversationId: 7, status: 'synced' }] })
      .mockResolvedValueOnce({
        transport: { status: 'committed' },
        deferredReplacementConversationIds: [],
        cleanupHasMoreDue: false,
        nextCleanupDueAt: null,
      });
    const scheduler = createGithubAutoSyncScheduler(
      { getInstanceId: () => 'reloaded-instance', githubSyncOrchestrator: { sync } as any },
      { now: () => now },
    );

    await scheduler.flushCleanup();
    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({ '7': 70_000 });
    expect(alarmsMocks.create).toHaveBeenCalledWith(GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME, { when: 75_000 });

    now = 70_000;
    await scheduler.flush();
    expect(sync).toHaveBeenNthCalledWith(2, {
      conversationIds: [7],
      mode: 'incremental',
      instanceId: 'reloaded-instance',
    });
    expect(storageState[GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]).toEqual({});

    now = 75_000;
    await scheduler.flushCleanup();
    expect(sync).toHaveBeenNthCalledWith(3, {
      conversationIds: [],
      mode: 'incremental',
      instanceId: 'reloaded-instance',
    });
  });
});
