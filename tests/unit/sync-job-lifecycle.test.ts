import { describe, expect, it, vi } from 'vitest';

import { createSyncJobLifecycle } from '@services/sync/sync-job-lifecycle';
import { normalizeSyncJobSnapshot } from '@services/sync/sync-job-store';
import type { SyncJobSnapshot } from '@services/sync/models';

function runningJob(conversationIds = [1, 2], overrides: Partial<SyncJobSnapshot> = {}): SyncJobSnapshot {
  return {
    id: 'job-1',
    provider: 'github',
    instanceId: 'test',
    status: 'running',
    startedAt: 1,
    updatedAt: 1,
    finishedAt: null,
    totalCount: conversationIds.length,
    conversationIds,
    okCount: 0,
    failCount: 0,
    perConversation: [],
    ...overrides,
  };
}

describe('sync job lifecycle', () => {
  it('never lets an empty later update erase a known conversation title', async () => {
    const persisted: SyncJobSnapshot[] = [];
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([1]),
      configuredConversationIds: [1],
      persist: async (job) => {
        persisted.push(job);
        return true;
      },
      now: () => 10,
    });

    await lifecycle.setItem(1, { currentStage: 'preparing_sync' });
    await lifecycle.setItem(1, { conversationTitle: 'Alpha', currentStage: 'working' });
    await lifecycle.setItem(1, { conversationTitle: '', currentStage: 'preparing_sync' });

    expect(lifecycle.titleFor(1)).toBe('Alpha');
    expect(persisted.at(-1)).toMatchObject({
      currentConversationId: 1,
      currentConversationTitle: 'Alpha',
      currentStage: 'preparing_sync',
    });
  });

  it('keeps every running persistence compact while completion count grows', async () => {
    const configuredConversationIds = Array.from({ length: 100 }, (_, index) => index + 1);
    const persisted: SyncJobSnapshot[] = [];
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([], { totalCount: 100 }),
      configuredConversationIds,
      persist: async (job) => {
        persisted.push(job);
        return true;
      },
      now: () => 20,
    });

    for (const conversationId of configuredConversationIds) {
      await lifecycle.setItem(conversationId, {
        conversationTitle: `Conversation ${conversationId}`,
        currentStage: 'working',
      });
      await lifecycle.completeItem({ conversationId, ok: true, mode: 'synced' });
    }

    expect(persisted).toHaveLength(200);
    for (const snapshot of persisted) {
      expect(snapshot).toMatchObject({ status: 'running', totalCount: 100, conversationIds: [], perConversation: [] });
    }
    expect(persisted.at(-1)).toMatchObject({ okCount: 100, failCount: 0 });

    await lifecycle.finish();
    expect(persisted.at(-1)).toMatchObject({
      status: 'done',
      totalCount: 100,
      conversationIds: configuredConversationIds,
      okCount: 100,
      failCount: 0,
    });
    expect(persisted.at(-1)?.perConversation).toHaveLength(100);
  });

  it('updates counters in O(1) semantics when the same result is overwritten', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([1]),
      configuredConversationIds: [1],
      persist,
      now: () => 30,
    });

    lifecycle.recordResult({ conversationId: 1, ok: true, mode: 'synced' });
    lifecycle.recordResult({ conversationId: 1, ok: false, mode: 'failed', error: 'later failure' });

    expect(lifecycle.summary()).toMatchObject({ okCount: 0, failCount: 1 });
    expect(lifecycle.summary().results).toMatchObject([{ conversationId: 1, ok: false, error: 'later failure' }]);
  });

  it('treats finish(rows) as replacement and counts duplicate ids by last write', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([1, 2]),
      configuredConversationIds: [1, 2],
      persist,
      now: () => 40,
    });
    lifecycle.recordResult({ conversationId: 1, ok: true, mode: 'old' });

    await lifecycle.finish([
      { conversationId: 2, ok: true, mode: 'first' },
      { conversationId: 1, ok: false, mode: 'failed', error: 'final one' },
      { conversationId: 2, ok: false, mode: 'failed', error: 'final two' },
    ]);

    expect(lifecycle.summary()).toMatchObject({ okCount: 0, failCount: 2 });
    expect(lifecycle.summary().results).toMatchObject([
      { conversationId: 1, ok: false, error: 'final one' },
      { conversationId: 2, ok: false, error: 'final two' },
    ]);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('deduplicates configured ids and preserves configured order before stable extras', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([]),
      configuredConversationIds: [1, 2, 1, 0, 3.5, 3, 2],
      persist,
      now: () => 50,
    });

    lifecycle.recordResult({ conversationId: 2, ok: true });
    lifecycle.recordResult({ conversationId: 99, ok: true });
    lifecycle.recordResult({ conversationId: 1, ok: true });
    lifecycle.recordResult({ conversationId: 100, ok: true });
    lifecycle.recordResult({ conversationId: 3, ok: true });

    expect(lifecycle.summary().results.map((row) => row.conversationId)).toEqual([1, 2, 3, 99, 100]);
    await lifecycle.finish();
    const terminal = persist.mock.calls.at(-1)?.[0];
    expect(terminal).toMatchObject({
      totalCount: 5,
      conversationIds: [1, 2, 3, 99, 100],
      okCount: 5,
      failCount: 0,
    });
    expect(terminal?.perConversation.map((row) => row.conversationId)).toEqual([1, 2, 3, 99, 100]);
    expect(normalizeSyncJobSnapshot('github', terminal)).toEqual(terminal);
  });

  it('falls back to the latest still-active worker when the current worker finishes', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob(),
      configuredConversationIds: [1, 2],
      persist,
      now: () => 60,
    });

    await lifecycle.setItem(1, { conversationTitle: 'First', currentStage: 'worker-one' });
    await lifecycle.setItem(2, { conversationTitle: 'Second', currentStage: 'worker-two' });
    await lifecycle.finishItem(2);

    expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({
      currentConversationId: 1,
      currentConversationTitle: 'First',
      currentStage: 'worker-one',
    });
  });

  it('refreshes active recency when an existing worker reports a later stage', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob(),
      configuredConversationIds: [1, 2],
      persist,
      now: () => 70,
    });

    await lifecycle.setItem(1, { conversationTitle: 'First', currentStage: 'worker-one' });
    await lifecycle.setItem(2, { conversationTitle: 'Second', currentStage: 'worker-two' });
    await lifecycle.setItem(1, { currentStage: 'worker-one-late' });
    await lifecycle.finishItem(2);

    expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({
      currentConversationId: 1,
      currentConversationTitle: 'First',
      currentStage: 'worker-one-late',
    });
  });

  it('clears current item fields after the last active item completes', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([1]),
      configuredConversationIds: [1],
      persist,
      now: () => 80,
    });

    await lifecycle.setItem(1, { conversationTitle: 'Only', currentStage: 'working' });
    await lifecycle.completeItem({ conversationId: 1, ok: true });

    expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({
      okCount: 1,
      failCount: 0,
      conversationIds: [],
      perConversation: [],
    });
    expect(persist.mock.calls.at(-1)?.[0].currentConversationId).toBeUndefined();
    expect(persist.mock.calls.at(-1)?.[0].currentConversationTitle).toBeUndefined();
    expect(persist.mock.calls.at(-1)?.[0].currentStage).toBeUndefined();
  });

  it('completes an item that never started without manufacturing a current item', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([1]),
      configuredConversationIds: [1],
      persist,
      now: () => 90,
    });

    await lifecycle.completeItem({
      conversationId: 1,
      conversationTitle: 'Lookup failed',
      ok: false,
      error: 'missing',
    });

    expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({ okCount: 0, failCount: 1 });
    expect(persist.mock.calls.at(-1)?.[0].currentConversationId).toBeUndefined();
    expect(lifecycle.titleFor(1)).toBe('Lookup failed');
  });

  it('supports an in-memory-only finish for staged providers', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([1]),
      configuredConversationIds: [1],
      persist,
      now: () => 100,
    });

    await lifecycle.setItem(1, { conversationTitle: 'Staged', currentStage: 'staging_projection' });
    expect(persist).toHaveBeenCalledTimes(1);
    await expect(lifecycle.finishItem(1, { persist: false })).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('clears item bookkeeping when switching to a run-level stage and ignores a late finish', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([1]),
      configuredConversationIds: [1],
      persist,
      now: () => 110,
    });

    await lifecycle.setItem(1, { conversationTitle: 'Staged', currentStage: 'staging_projection' });
    await lifecycle.setRunStage('committing_tree');
    await lifecycle.finishItem(1);

    expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({ currentStage: 'committing_tree' });
    expect(persist.mock.calls.at(-1)?.[0].currentConversationId).toBeUndefined();
    expect(persist.mock.calls.at(-1)?.[0].currentConversationTitle).toBeUndefined();
  });

  it('normalizes results, preserves configured order, and derives failures from one result source', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob(),
      configuredConversationIds: [1, 2],
      persist,
      now: () => 120,
    });

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

  it('preserves completed rows and known identities when a run-level failure closes pending items with one terminal write', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob(),
      configuredConversationIds: [1, 2],
      persist,
      now: () => 130,
    });

    await lifecycle.setItem(1, { conversationTitle: 'Done', currentStage: 'working' });
    lifecycle.recordResult({ conversationId: 1, ok: true, mode: 'synced' });
    await lifecycle.setItem(2, { conversationTitle: 'Pending', currentStage: 'working' });
    const writesBeforeFailure = persist.mock.calls.length;
    await lifecycle.failPending(Object.assign(new Error('transport failed'), { code: 'transport_failed' }));

    expect(persist).toHaveBeenCalledTimes(writesBeforeFailure + 1);
    expect(lifecycle.summary().results).toMatchObject([
      { conversationId: 1, conversationTitle: 'Done', ok: true, mode: 'synced' },
      { conversationId: 2, conversationTitle: 'Pending', ok: false, mode: 'failed', error: 'transport_failed' },
    ]);
    expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'done',
      conversationIds: [1, 2],
      okCount: 1,
      failCount: 1,
    });
  });

  it('uses the configured execution queue as the only running total source', async () => {
    const persist = vi.fn(async () => true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([], { totalCount: 7, okCount: 2, failCount: 1 }),
      configuredConversationIds: [1, 2],
      persist,
      now: () => 140,
    });

    await lifecycle.setRunStage('preparing_queue');
    expect(persist.mock.calls.at(-1)?.[0]).toMatchObject({ totalCount: 2, conversationIds: [], perConversation: [] });
  });

  it('does not let one rejected persistence poison later progress writes', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValueOnce(true);
    const lifecycle = createSyncJobLifecycle({
      initialJob: runningJob([1]),
      configuredConversationIds: [1],
      persist,
      now: () => 150,
    });

    await expect(lifecycle.setRunStage('preparing_sync')).resolves.toBe(false);
    await expect(lifecycle.setItem(1, { conversationTitle: 'Recovered', currentStage: 'working' })).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
  });
});
