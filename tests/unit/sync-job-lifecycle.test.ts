import { describe, expect, it, vi } from 'vitest';

import { createSyncJobLifecycle } from '@services/sync/sync-job-lifecycle';
import type { SyncJobSnapshot } from '@services/sync/models';

function runningJob(conversationIds = [1, 2]): SyncJobSnapshot {
  return {
    id: 'job-1',
    provider: 'github',
    instanceId: 'test',
    status: 'running',
    startedAt: 1,
    updatedAt: 1,
    finishedAt: null,
    conversationIds,
    okCount: 0,
    failCount: 0,
    perConversation: [],
  };
}

describe('sync job lifecycle', () => {
  it('never lets an empty later update erase a known conversation title', async () => {
    const persisted: SyncJobSnapshot[] = [];
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([1]),
      persist: async (job) => {
        persisted.push(job);
        return true;
      },
      now: () => 10,
    });

    await lifecycle.setItem(1, { currentStage: 'loading_conversation' });
    await lifecycle.setItem(1, { conversationTitle: 'Alpha', currentStage: 'working' });
    await lifecycle.setItem(1, { conversationTitle: '', currentStage: 'finishing_current_item' });

    expect(lifecycle.titleFor(1)).toBe('Alpha');
    expect(persisted.at(-1)).toMatchObject({
      currentConversationId: 1,
      currentConversationTitle: 'Alpha',
      currentStage: 'finishing_current_item',
    });
  });

  it('keeps id/title pairs isolated when concurrent workers interleave', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({ initialJob: runningJob(), persist, now: () => 20 });

    await Promise.all([
      lifecycle.setItem(1, { conversationTitle: 'First', currentStage: 'worker-one' }),
      lifecycle.setItem(2, { conversationTitle: 'Second', currentStage: 'worker-two' }),
    ]);
    await lifecycle.setItem(1, { conversationTitle: undefined, currentStage: 'worker-one-late' });

    expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({
      currentConversationId: 1,
      currentConversationTitle: 'First',
      currentStage: 'worker-one-late',
    });
    expect(lifecycle.titleFor(2)).toBe('Second');
  });

  it('normalizes results, preserves input order, and derives counts from one result source', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({ initialJob: runningJob(), persist, now: () => 30 });

    await lifecycle.setItem(2, { conversationTitle: 'Second', currentStage: 'working' });
    lifecycle.recordResult({ conversationId: 2, ok: true, mode: 'synced', appended: 3, error: '', at: 12 });
    await lifecycle.setItem(1, { conversationTitle: 'First', currentStage: 'working' });
    lifecycle.recordResult({ conversationId: 1, ok: false, error: 'boom' });
    await lifecycle.finish();

    expect(lifecycle.summary().results).toMatchObject([
      { conversationId: 1, conversationTitle: 'First', ok: false, mode: 'failed', appended: 0, error: 'boom' },
      { conversationId: 2, conversationTitle: 'Second', ok: true, mode: 'synced', appended: 3, error: '' },
    ]);
    expect(lifecycle.summary()).toMatchObject({
      provider: 'github',
      instanceId: 'test',
      okCount: 1,
      failCount: 1,
      failures: [{ conversationId: 1, conversationTitle: 'First', error: 'boom' }],
    });
    expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'done', okCount: 1, failCount: 1 });
  });

  it('preserves completed rows and known identities when a run-level failure closes pending items', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({ initialJob: runningJob(), persist, now: () => 40 });

    await lifecycle.setItem(1, { conversationTitle: 'Done', currentStage: 'working' });
    lifecycle.recordResult({ conversationId: 1, ok: true, mode: 'synced' });
    await lifecycle.setItem(2, { conversationTitle: 'Pending', currentStage: 'working' });
    await lifecycle.failPending(Object.assign(new Error('transport failed'), { code: 'transport_failed' }));

    expect(lifecycle.summary().results).toMatchObject([
      { conversationId: 1, conversationTitle: 'Done', ok: true, mode: 'synced' },
      { conversationId: 2, conversationTitle: 'Pending', ok: false, mode: 'failed', error: 'transport_failed' },
    ]);
    expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'done', okCount: 1, failCount: 1 });
  });

  it('does not let one failed persistence poison later progress writes', async () => {
    const persist = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const lifecycle = createSyncJobLifecycle({ initialJob: runningJob([1]), persist, now: () => 50 });

    await expect(lifecycle.setRunStage('loading_conversation')).resolves.toBe(false);
    await expect(lifecycle.setItem(1, { conversationTitle: 'Recovered', currentStage: 'working' })).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
  });
});
