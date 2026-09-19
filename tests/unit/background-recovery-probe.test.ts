import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FEISHU_AUTO_SYNC_QUEUE_STORAGE_KEY,
  GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
  GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY,
  NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY,
  OBSIDIAN_AUTO_SYNC_QUEUE_STORAGE_KEY,
} from '@services/sync/auto-sync/auto-sync-keys';
import { AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY } from '@services/conversations/background/image-backfill-scheduler';
import { readBackgroundRecoveryProbe } from '@services/bootstrap/background-recovery-probe';
import { SYNC_JOB_STORAGE_KEYS } from '@services/sync/sync-job-store';
import { syncProviderEnabledStorageKey } from '@services/sync/sync-provider-gate';

const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@services/shared/storage', () => ({
  storageGet: storageMocks.get,
}));

function runningJob(provider: 'notion' | 'obsidian' | 'feishu' | 'github', instanceId = 'old-instance') {
  return {
    id: `${provider}-job`,
    provider,
    instanceId,
    status: 'running',
    startedAt: 1,
    updatedAt: 2,
    finishedAt: null,
    totalCount: 1,
    conversationIds: [],
    currentConversationId: 7,
    currentConversationTitle: 'Current',
    currentStage: 'preparing_sync',
    okCount: 0,
    failCount: 0,
    perConversation: [],
  };
}

beforeEach(() => {
  storageMocks.get.mockReset();
});

describe('background recovery probe', () => {
  it('reads all durable recovery hints once and returns only normalized work presence', async () => {
    const githubProviderKey = syncProviderEnabledStorageKey('github');
    storageMocks.get.mockResolvedValue({
      [SYNC_JOB_STORAGE_KEYS.notion]: runningJob('notion'),
      [SYNC_JOB_STORAGE_KEYS.obsidian]: {
        ...runningJob('obsidian'),
        status: 'done',
        finishedAt: 3,
        conversationIds: [7],
        currentConversationId: undefined,
        currentConversationTitle: undefined,
        currentStage: undefined,
        okCount: 1,
        perConversation: [
          {
            conversationId: 7,
            conversationTitle: 'Done',
            ok: true,
            mode: 'synced',
            appended: 0,
            error: '',
            at: 3,
          },
        ],
      },
      [NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY]: { '7': 100, '1.5': 50, bad: -1 },
      [OBSIDIAN_AUTO_SYNC_QUEUE_STORAGE_KEY]: {},
      [FEISHU_AUTO_SYNC_QUEUE_STORAGE_KEY]: { '8': 200 },
      [GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY]: null,
      [AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]: { '9': 300 },
      [GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY]: true,
      [githubProviderKey]: undefined,
    });

    const probe = await readBackgroundRecoveryProbe();

    expect(probe.providers.notion).toMatchObject({
      runningJob: { provider: 'notion', instanceId: 'old-instance' },
      hasQueuedWork: true,
    });
    expect(probe.providers.obsidian).toEqual({ runningJob: null, hasQueuedWork: false });
    expect(probe.providers.feishu).toEqual({ runningJob: null, hasQueuedWork: true });
    expect(probe.providers.github).toEqual({ runningJob: null, hasQueuedWork: false });
    expect(probe.imageBackfillHasQueuedWork).toBe(true);
    expect(probe.githubCleanupEnabled).toBe(true);

    expect(storageMocks.get).toHaveBeenCalledTimes(1);
    const keys = storageMocks.get.mock.calls[0]?.[0] as string[];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        ...Object.values(SYNC_JOB_STORAGE_KEYS),
        NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY,
        OBSIDIAN_AUTO_SYNC_QUEUE_STORAGE_KEY,
        FEISHU_AUTO_SYNC_QUEUE_STORAGE_KEY,
        GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY,
        AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY,
        GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY,
        githubProviderKey,
      ]),
    );
  });

  it('keeps GitHub cleanup disabled unless auto-sync is explicitly enabled and the provider gate is not false', async () => {
    const githubProviderKey = syncProviderEnabledStorageKey('github');
    storageMocks.get.mockResolvedValueOnce({
      [GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY]: false,
      [githubProviderKey]: undefined,
    });
    await expect(readBackgroundRecoveryProbe()).resolves.toMatchObject({ githubCleanupEnabled: false });

    storageMocks.get.mockResolvedValueOnce({
      [GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY]: true,
      [githubProviderKey]: false,
    });
    await expect(readBackgroundRecoveryProbe()).resolves.toMatchObject({ githubCleanupEnabled: false });
  });

  it('propagates storage read failure instead of manufacturing idle recovery state', async () => {
    storageMocks.get.mockRejectedValue(new Error('storage unavailable'));
    await expect(readBackgroundRecoveryProbe()).rejects.toThrow('storage unavailable');
  });
});
