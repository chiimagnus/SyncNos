import { afterEach, describe, expect, it, vi } from 'vitest';

import { createContentController } from '@services/bootstrap/content-controller.ts';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture.ts';

type TickFn = (() => void | Promise<void>) | null;

function cloneSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function createHarness(options: {
  snapshots: any[];
  tailWindows?: Array<{ conversationId: number | null; messages: any[] }>;
  incrementalImpl?: (snapshot: any, callCount: number) => any;
  collectorId?: string;
}) {
  let tickRef: TickFn = null;
  const sendCalls: Array<{ type: string; payload?: any }> = [];
  let captureCount = 0;
  let tailWindowCount = 0;
  let incrementalCallCount = 0;

  const runtime = {
    send: async (type: string, payload?: any) => {
      sendCalls.push({ type, payload });
      if (type === 'getConversationTailWindowBySourceAndKey') {
        const item =
          options.tailWindows?.[Math.min(tailWindowCount, Math.max(0, (options.tailWindows?.length || 1) - 1))] || {
            conversationId: null,
            messages: [],
          };
        tailWindowCount += 1;
        return { ok: true, data: cloneSnapshot(item) };
      }
      if (type === 'upsertConversation') return { ok: true, data: { id: 101, __isNew: false } };
      if (type === 'syncConversationMessages') return { ok: true, data: { upserted: Number(payload?.messages?.length) || 0 } };
      return { ok: true, data: {} };
    },
    onInvalidated: () => () => {},
    isInvalidContextError: () => false,
  };

  const collector = {
    capture: () => {
      const index = Math.min(captureCount, Math.max(0, options.snapshots.length - 1));
      captureCount += 1;
      return cloneSnapshot(options.snapshots[index]);
    },
  };

  const collectorsRegistry = {
    pickActive: () => ({ id: options.collectorId || 'chatgpt', collector }),
    list: () => [],
  };

  const currentPageCapture = createCurrentPageCaptureService({
    runtime,
    collectorsRegistry,
  });

  const controller = createContentController({
    runtime,
    collectorsRegistry,
    currentPageCapture,
    inpageTip: null,
    inpageButton: {
      ensureInpageButton: () => {},
      cleanupButtons: () => {},
      setSaving: () => {},
    },
    runtimeObserver: {
      createObserver: ({ onTick }: { onTick?: () => void | Promise<void> }) => {
        tickRef = onTick || null;
        return { start: () => {}, stop: () => {} };
      },
    },
    incrementalUpdater: {
      computeIncremental: (snapshot: any) => {
        incrementalCallCount += 1;
        if (typeof options.incrementalImpl === 'function') {
          return options.incrementalImpl(snapshot, incrementalCallCount);
        }
        return { changed: false };
      },
    },
    notionAiModelPicker: null,
    itemMention: null,
  });
  controller.start();

  return {
    sendCalls,
    runTick: async () => {
      if (tickRef) await tickRef();
    },
    getIncrementalCallCount: () => incrementalCallCount,
  };
}

function makeSnapshot(conversationKey: string, contents: string[]) {
  return {
    conversation: { source: 'chatgpt', conversationKey },
    messages: contents.map((contentText, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      contentText,
      sequence: index + 1,
    })),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('content-controller ai chat autosave backfill', () => {
  it('writes page window once when local tail is empty', async () => {
    const snapshot = makeSnapshot('c-empty', ['A', 'B']);
    const harness = createHarness({
      snapshots: [snapshot],
      tailWindows: [{ conversationId: null, messages: [] }],
      incrementalImpl: () => ({ changed: false }),
    });

    await harness.runTick();

    const tailCalls = harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey');
    expect(tailCalls).toHaveLength(1);
    expect(tailCalls[0].payload).toMatchObject({
      source: 'chatgpt',
      conversationKey: 'c-empty',
      limit: 200,
    });

    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0].payload.mode).toBe('append');
    expect(syncCalls[0].payload.messages.map((entry: any) => entry.contentText)).toEqual(['A', 'B']);
    expect(syncCalls[0].payload.diff.added).toHaveLength(2);
    expect(harness.getIncrementalCallCount()).toBe(1);
  });

  it('writes append-only gap when overlap exists in tail', async () => {
    const snapshot = makeSnapshot('c-overlap-tail', ['A', 'B', 'C']);
    const harness = createHarness({
      snapshots: [snapshot],
      tailWindows: [
        {
          conversationId: 55,
          messages: [
            { role: 'user', contentText: 'A', sequence: 1, messageKey: 'm1' },
            { role: 'assistant', contentText: 'B', sequence: 2, messageKey: 'm2' },
          ],
        },
      ],
      incrementalImpl: () => ({ changed: false }),
    });

    await harness.runTick();

    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0].payload.mode).toBe('append');
    expect(syncCalls[0].payload.messages.map((entry: any) => entry.contentText)).toEqual(['C']);
  });

  it('merges backfill and incremental deltas into one append write in the same tick', async () => {
    const harness = createHarness({
      snapshots: [makeSnapshot('c-backfill-plus-incremental', ['A', 'B', 'C'])],
      tailWindows: [
        {
          conversationId: 81,
          messages: [
            { role: 'user', contentText: 'A', sequence: 1, messageKey: 'm1' },
            { role: 'assistant', contentText: 'B', sequence: 2, messageKey: 'm2' },
          ],
        },
      ],
      incrementalImpl: () => ({
        changed: true,
        snapshot: {
          conversation: { source: 'chatgpt', conversationKey: 'c-backfill-plus-incremental' },
          messages: [{ messageKey: 'inc_1', role: 'assistant', contentText: 'delta', sequence: 999 }],
        },
        diff: { added: ['inc_1'], updated: [], removed: [] },
      }),
    });

    await harness.runTick();

    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0].payload.messages.map((entry: any) => entry.contentText)).toEqual(['C', 'delta']);
    expect(syncCalls[0].payload.diff.added).toContain('inc_1');
  });

  it('skips writes when no overlap and can continue later ticks', async () => {
    vi.useFakeTimers();
    const harness = createHarness({
      snapshots: [makeSnapshot('c-no-overlap', ['A', 'B']), makeSnapshot('c-no-overlap', ['A', 'B', 'C'])],
      tailWindows: [
        {
          conversationId: 61,
          messages: [
            { role: 'user', contentText: 'X', sequence: 1, messageKey: 'x1' },
            { role: 'assistant', contentText: 'Y', sequence: 2, messageKey: 'y1' },
          ],
        },
        {
          conversationId: 61,
          messages: [
            { role: 'user', contentText: 'X', sequence: 1, messageKey: 'x1' },
            { role: 'assistant', contentText: 'Y', sequence: 2, messageKey: 'y1' },
          ],
        },
      ],
      incrementalImpl: () => ({ changed: false }),
    });

    await harness.runTick();
    await vi.advanceTimersByTimeAsync(10_000);
    await harness.runTick();

    expect(harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey')).toHaveLength(2);
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(0);
  });

  it('retries when page signature changes and succeeds after overlap appears', async () => {
    vi.useFakeTimers();
    const harness = createHarness({
      snapshots: [makeSnapshot('c-retry', ['A', 'B']), makeSnapshot('c-retry', ['A', 'B', 'C'])],
      tailWindows: [
        {
          conversationId: 71,
          messages: [
            { role: 'user', contentText: 'X', sequence: 1, messageKey: 'x1' },
            { role: 'assistant', contentText: 'Y', sequence: 2, messageKey: 'y1' },
          ],
        },
        {
          conversationId: 71,
          messages: [
            { role: 'user', contentText: 'A', sequence: 1, messageKey: 'm1' },
            { role: 'assistant', contentText: 'B', sequence: 2, messageKey: 'm2' },
          ],
        },
      ],
      incrementalImpl: () => ({ changed: false }),
    });

    await harness.runTick();
    await vi.advanceTimersByTimeAsync(10_000);
    await harness.runTick();

    expect(harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey')).toHaveLength(2);
    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0].payload.mode).toBe('append');
    expect(syncCalls[0].payload.messages.map((entry: any) => entry.contentText)).toEqual(['C']);
  });
});
