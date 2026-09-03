import { afterEach, describe, expect, it, vi } from 'vitest';

import { AI_CHAT_AUTO_SAVE_COLLECTOR_IDS } from '@collectors/ai-chat-sites.ts';
import { createContentController } from '@services/bootstrap/content-controller.ts';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture.ts';
import normalizeApi from '@services/shared/normalize.ts';
import { getMessageIdentityMeta } from '@services/conversations/content/autosave-identity-utils.ts';
import { createAutoSaveIncrementalEngine } from '@services/conversations/content/autosave-incremental-engine.ts';

type TickFn = (() => void | Promise<void>) | null;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function cloneSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function createHarness(options: {
  snapshots: any[];
  tailWindows?: Array<{ conversationId: number | null; messages: any[] }>;
  incrementalImpl?: (snapshot: any, callCount: number) => any;
  collectorId?: string;
  collectorResolver?: () => { id: string; collector: any } | null;
  sendImpl?: (type: string, payload?: any) => Promise<any> | any;
}) {
  let tickRef: TickFn = null;
  const sendCalls: Array<{ type: string; payload?: any }> = [];
  const tipCalls: Array<{ text: string; options?: any }> = [];
  let captureCount = 0;
  let tailWindowCount = 0;
  let incrementalCallCount = 0;
  let buttonConfig: any = null;

  const runtime = {
    send: async (type: string, payload?: any) => {
      sendCalls.push({ type, payload });
      if (typeof options.sendImpl === 'function') {
        const overridden = await options.sendImpl(type, payload);
        if (typeof overridden !== 'undefined') return overridden;
      }
      if (type === 'getConversationTailWindowBySourceAndKey') {
        const item = options.tailWindows?.[
          Math.min(tailWindowCount, Math.max(0, (options.tailWindows?.length || 1) - 1))
        ] || {
          conversationId: null,
          messages: [],
        };
        tailWindowCount += 1;
        return { ok: true, data: cloneSnapshot(item) };
      }
      if (type === 'upsertConversation') return { ok: true, data: { id: 101, __isNew: false } };
      if (type === 'syncConversationMessages')
        return { ok: true, data: { upserted: Number(payload?.messages?.length) || 0 } };
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
    pickActive: () => options.collectorResolver?.() || { id: options.collectorId || 'gemini', collector },
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
    inpageTip: {
      showSaveTip: (text: string, options?: any) => {
        tipCalls.push({ text, options });
      },
    },
    inpageButton: {
      ensureInpageButton: (config: any) => {
        buttonConfig = config;
      },
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
      prepareIncremental: (snapshot: any) => {
        incrementalCallCount += 1;
        const result =
          typeof options.incrementalImpl === 'function'
            ? options.incrementalImpl(snapshot, incrementalCallCount)
            : { changed: false };
        return {
          changed: result?.changed === true,
          snapshot: result?.snapshot || {
            ...snapshot,
            conversation: { ...(snapshot?.conversation || {}) },
            messages: [],
          },
          diff: result?.diff || { added: [], updated: [], removed: [] },
          commit: typeof result?.commit === 'function' ? result.commit : () => true,
        };
      },
    },
    itemMention: null,
  });
  let resident = controller.start();

  return {
    controller,
    getResident: () => resident,
    restartResident: () => {
      resident?.stop?.();
      resident = controller.start();
      return resident;
    },
    stopResident: () => resident?.stop?.(),
    sendCalls,
    getCaptureCount: () => captureCount,
    tipCalls,
    getButtonConfig: () => buttonConfig,
    settle: flushMicrotasks,
    runTick: async () => {
      if (tickRef) await tickRef();
      await flushMicrotasks();
    },
    getIncrementalCallCount: () => incrementalCallCount,
  };
}

function makeSnapshot(conversationKey: string, contents: string[]) {
  return {
    conversation: { source: 'gemini', conversationKey },
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
      source: 'gemini',
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

  it('dedupes incremental seed vs backfill first-write by aligning synthetic keys', async () => {
    const snapshot = makeSnapshot('c-empty-plus-seed', ['A', 'B']);
    const stateKey = `gemini::c-empty-plus-seed`;
    const stateKeyHash = String((normalizeApi as any).fnv1a32(stateKey));
    const expectedKeys = snapshot.messages.map((message: any) => {
      const meta = getMessageIdentityMeta(message);
      return `autosave_${stateKeyHash}_${meta.identityHash}_s1`;
    });
    const harness = createHarness({
      snapshots: [snapshot],
      tailWindows: [{ conversationId: null, messages: [] }],
      incrementalImpl: () => ({
        changed: true,
        snapshot: {
          conversation: { source: 'gemini', conversationKey: 'c-empty-plus-seed' },
          messages: snapshot.messages.map((message: any, index: number) => ({
            ...message,
            messageKey: expectedKeys[index],
          })),
        },
        diff: { added: expectedKeys, updated: [], removed: [] },
      }),
    });

    await harness.runTick();

    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0].payload.mode).toBe('append');
    expect(syncCalls[0].payload.messages).toHaveLength(2);
    expect(syncCalls[0].payload.messages.map((entry: any) => entry.contentText)).toEqual(['A', 'B']);
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
    expect(harness.tipCalls.length).toBeGreaterThan(0);
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
          conversation: { source: 'gemini', conversationKey: 'c-backfill-plus-incremental' },
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

    expect(harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey')).toHaveLength(
      2,
    );
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

    expect(harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey')).toHaveLength(
      2,
    );
    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0].payload.mode).toBe('append');
    expect(syncCalls[0].payload.messages.map((entry: any) => entry.contentText)).toEqual(['C']);
  });

  it('throttles backfill retries until retry interval elapses', async () => {
    vi.useFakeTimers();
    const harness = createHarness({
      snapshots: [
        makeSnapshot('c-throttle', ['A']),
        makeSnapshot('c-throttle', ['A', 'B']),
        makeSnapshot('c-throttle', ['A', 'B', 'C']),
      ],
      tailWindows: [
        {
          conversationId: 91,
          messages: [{ role: 'user', contentText: 'X', sequence: 1, messageKey: 'x1' }],
        },
      ],
      incrementalImpl: () => ({ changed: false }),
    });

    await harness.runTick();
    await harness.runTick();
    expect(harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey')).toHaveLength(
      1,
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await harness.runTick();
    expect(harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey')).toHaveLength(
      2,
    );
  });

  it('stops backfill retries after max attempt limit', async () => {
    vi.useFakeTimers();
    const snapshots = Array.from({ length: 8 }, (_, index) => {
      const size = index + 1;
      return makeSnapshot(
        'c-attempt-limit',
        Array.from({ length: size }, (_unused, messageIndex) => `M${messageIndex + 1}`),
      );
    });
    const harness = createHarness({
      snapshots,
      tailWindows: [
        {
          conversationId: 101,
          messages: [{ role: 'user', contentText: 'X', sequence: 1, messageKey: 'x1' }],
        },
      ],
      incrementalImpl: () => ({ changed: false }),
    });

    for (let i = 0; i < snapshots.length; i += 1) {
      await harness.runTick();
      await vi.advanceTimersByTimeAsync(10_000);
    }

    expect(harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey')).toHaveLength(
      6,
    );
  });

  it('stops backfill retries after max retry duration', async () => {
    vi.useFakeTimers();
    const harness = createHarness({
      snapshots: [makeSnapshot('c-duration-limit', ['A']), makeSnapshot('c-duration-limit', ['A', 'B'])],
      tailWindows: [
        {
          conversationId: 111,
          messages: [{ role: 'user', contentText: 'X', sequence: 1, messageKey: 'x1' }],
        },
      ],
      incrementalImpl: () => ({ changed: false }),
    });

    await harness.runTick();
    await vi.advanceTimersByTimeAsync(121_000);
    await harness.runTick();

    expect(harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey')).toHaveLength(
      1,
    );
  });

  it('retries backfill after transient append failure on next eligible tick', async () => {
    vi.useFakeTimers();
    let syncAttempt = 0;
    const harness = createHarness({
      snapshots: [makeSnapshot('c-write-fail', ['A', 'B']), makeSnapshot('c-write-fail', ['A', 'B', 'C'])],
      tailWindows: [{ conversationId: null, messages: [] }],
      incrementalImpl: () => ({ changed: false }),
      sendImpl: (type: string) => {
        if (type !== 'syncConversationMessages') return undefined;
        syncAttempt += 1;
        if (syncAttempt === 1) return { ok: false, error: { message: 'sync failed once' } };
        return { ok: true, data: { upserted: 1 } };
      },
    });

    await harness.runTick();
    await vi.advanceTimersByTimeAsync(10_000);
    await harness.runTick();

    const tailCalls = harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey');
    expect(tailCalls).toHaveLength(2);

    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(2);
    expect(syncCalls[1].payload.messages.map((entry: any) => entry.contentText)).toEqual(['A', 'B', 'C']);
  });

  it('retries backfill for the same page signature after append write failure', async () => {
    vi.useFakeTimers();
    let syncAttempt = 0;
    const snapshot = makeSnapshot('c-same-signature-retry', ['A', 'B']);
    const harness = createHarness({
      snapshots: [snapshot, snapshot],
      tailWindows: [
        { conversationId: null, messages: [] },
        { conversationId: null, messages: [] },
      ],
      incrementalImpl: () => ({ changed: false }),
      sendImpl: (type: string) => {
        if (type !== 'syncConversationMessages') return undefined;
        syncAttempt += 1;
        if (syncAttempt === 1) return { ok: false, error: { message: 'sync failed once' } };
        return { ok: true, data: { upserted: 2 } };
      },
    });

    await harness.runTick();
    await vi.advanceTimersByTimeAsync(10_000);
    await harness.runTick();

    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(2);
    expect(syncCalls[1].payload.messages.map((entry: any) => entry.contentText)).toEqual(['A', 'B']);
  });

  it('does not commit incremental baseline until durable save succeeds', async () => {
    const engine = createAutoSaveIncrementalEngine();
    const page = makeSnapshot('transactional-retry', ['A', 'B']);
    let syncAttempt = 0;
    const harness = createHarness({
      snapshots: [page, page, page],
      tailWindows: [{ conversationId: 1, messages: page.messages }],
      incrementalImpl: (snapshot) => engine.prepare(snapshot),
      sendImpl: (type: string) => {
        if (type !== 'syncConversationMessages') return undefined;
        syncAttempt += 1;
        if (syncAttempt === 1) return { ok: false, error: { message: 'save failed once' } };
        return { ok: true, data: { upserted: 2 } };
      },
    });

    await harness.runTick();
    await harness.runTick();
    await harness.runTick();

    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(2);
    expect(syncCalls[1].payload.diff).toEqual(syncCalls[0].payload.diff);
    expect(syncCalls[1].payload.messages.map((m: any) => m.messageKey)).toEqual(
      syncCalls[0].payload.messages.map((m: any) => m.messageKey),
    );
  });

  it('persists metadata-only incremental changes with an empty append message set', async () => {
    const engine = createAutoSaveIncrementalEngine();
    const base = {
      conversation: { source: 'gemini', conversationKey: 'metadata-only', title: 'Old', url: 'https://a' },
      messages: [{ messageKey: 'm1', role: 'user', contentText: 'A', sequence: 1 }],
    };
    const changed = {
      conversation: { source: 'gemini', conversationKey: 'metadata-only', title: 'New', url: 'https://b' },
      messages: [{ messageKey: 'm1', role: 'user', contentText: 'A', sequence: 1 }],
    };
    const harness = createHarness({
      snapshots: [base, changed],
      tailWindows: [{ conversationId: 1, messages: base.messages }],
      incrementalImpl: (snapshot) => engine.prepare(snapshot),
    });

    await harness.runTick();
    await harness.runTick();

    const upserts = harness.sendCalls.filter((entry) => entry.type === 'upsertConversation');
    const syncs = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(upserts).toHaveLength(2);
    expect(upserts[1].payload.payload).toMatchObject({ title: 'New', url: 'https://b' });
    expect(syncs[1].payload.messages).toEqual([]);
    expect(syncs[1].payload.diff).toEqual({ added: [], updated: [], removed: [] });
  });

  it('uses incremental effective metadata when only backfill needs persistence', async () => {
    vi.useFakeTimers();
    const engine = createAutoSaveIncrementalEngine();
    const messages = Array.from({ length: 7 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      contentText: `M${index + 1}`,
      sequence: index + 1,
    }));
    const base = {
      conversation: { source: 'gemini', conversationKey: 'carry-backfill', title: 'Kept', url: 'https://kept' },
      messages,
    };
    const emptyMeta = {
      conversation: { source: 'gemini', conversationKey: 'carry-backfill', title: '', url: '' },
      messages,
    };
    let tailAttempt = 0;
    const harness = createHarness({
      snapshots: [base, emptyMeta],
      tailWindows: [{ conversationId: 1, messages: messages.slice(0, -1) }],
      incrementalImpl: (snapshot) => engine.prepare(snapshot),
      sendImpl: (type: string) => {
        if (type !== 'getConversationTailWindowBySourceAndKey') return undefined;
        tailAttempt += 1;
        if (tailAttempt === 1) return { ok: false, error: { message: 'tail unavailable once' } };
        return undefined;
      },
    });

    await harness.runTick();
    expect(harness.sendCalls.filter((entry) => entry.type === 'upsertConversation')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_000);
    await harness.runTick();

    const upsert = harness.sendCalls.find((entry) => entry.type === 'upsertConversation');
    expect(upsert?.payload.payload).toMatchObject({ title: 'Kept', url: 'https://kept' });
  });

  it('releases backfill marker when a changed=false preparation commit is stale before save', async () => {
    vi.useFakeTimers();
    let prepareCount = 0;
    const harness = createHarness({
      snapshots: [makeSnapshot('precommit-stale', ['A']), makeSnapshot('precommit-stale', ['A'])],
      tailWindows: [
        { conversationId: null, messages: [] },
        { conversationId: null, messages: [] },
      ],
      incrementalImpl: (snapshot) => {
        prepareCount += 1;
        return {
          changed: false,
          snapshot: { ...snapshot, conversation: { ...snapshot.conversation }, messages: [] },
          diff: { added: [], updated: [], removed: [] },
          commit: () => {
            if (prepareCount === 1) throw new Error('autosave_incremental_prepare_stale');
            return true;
          },
        };
      },
    });

    await harness.runTick();
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_000);
    await harness.runTick();
    expect(harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey')).toHaveLength(
      2,
    );
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(1);
  });

  it('does not roll back durable backfill when incremental commit is stale after save', async () => {
    let prepareCount = 0;
    const harness = createHarness({
      snapshots: [makeSnapshot('postcommit-stale', ['A']), makeSnapshot('postcommit-stale', ['A'])],
      tailWindows: [{ conversationId: null, messages: [] }],
      incrementalImpl: (snapshot) => {
        prepareCount += 1;
        return {
          changed: true,
          snapshot: {
            ...snapshot,
            conversation: { ...snapshot.conversation },
            messages: [{ messageKey: 'inc-1', role: 'user', contentText: 'A', sequence: 1 }],
          },
          diff: { added: ['inc-1'], updated: [], removed: [] },
          commit: () => {
            if (prepareCount === 1) throw new Error('autosave_incremental_prepare_stale');
            return true;
          },
        };
      },
    });

    await harness.runTick();
    expect(harness.tipCalls).toHaveLength(0);
    await harness.runTick();

    expect(harness.sendCalls.filter((entry) => entry.type === 'getConversationTailWindowBySourceAndKey')).toHaveLength(
      1,
    );
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(2);
    expect(harness.tipCalls).toHaveLength(1);
  });

  it('keeps one active autosave plus one latest trailing request and resolves the trailing collector fresh', async () => {
    const firstSync = deferred<any>();
    let syncCount = 0;
    const captureA = vi.fn(() => makeSnapshot('scheduler-a', ['A']));
    const captureB = vi.fn(() => makeSnapshot('scheduler-b', ['B']));
    let current = { id: 'gemini', collector: { capture: captureA } };
    const harness = createHarness({
      snapshots: [makeSnapshot('unused', ['U'])],
      collectorResolver: () => current,
      incrementalImpl: (snapshot) => ({
        changed: true,
        snapshot: {
          ...snapshot,
          conversation: { ...snapshot.conversation },
          messages: [{ ...snapshot.messages[0], messageKey: `${snapshot.conversation.conversationKey}-delta` }],
        },
        diff: { added: [`${snapshot.conversation.conversationKey}-delta`], updated: [], removed: [] },
        commit: () => true,
      }),
      sendImpl: (type: string) => {
        if (type !== 'syncConversationMessages') return undefined;
        syncCount += 1;
        if (syncCount === 1) return firstSync.promise;
        return { ok: true, data: { upserted: 1 } };
      },
    });
    await harness.settle();

    await harness.runTick();
    expect(captureA).toHaveBeenCalledTimes(1);
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(1);

    await harness.runTick();
    await harness.runTick();
    expect(captureA).toHaveBeenCalledTimes(1);
    current = { id: 'notionai', collector: { capture: captureB } };

    firstSync.resolve({ ok: true, data: { upserted: 1 } });
    await harness.settle();
    await harness.settle();

    expect(captureA).toHaveBeenCalledTimes(1);
    expect(captureB).toHaveBeenCalledTimes(1);
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(2);
  });

  it('drops a trailing autosave when the fresh page no longer has an autosave collector', async () => {
    const firstSync = deferred<any>();
    let syncCount = 0;
    const captureA = vi.fn(() => makeSnapshot('scheduler-drop-a', ['A']));
    const captureWeb = vi.fn(() => makeSnapshot('scheduler-drop-web', ['W']));
    let current = { id: 'gemini', collector: { capture: captureA } };
    const harness = createHarness({
      snapshots: [makeSnapshot('unused', ['U'])],
      collectorResolver: () => current,
      incrementalImpl: (snapshot) => ({
        changed: true,
        snapshot: { ...snapshot, conversation: { ...snapshot.conversation }, messages: [] },
        diff: { added: [], updated: [], removed: [] },
        commit: () => true,
      }),
      sendImpl: (type: string) => {
        if (type !== 'syncConversationMessages') return undefined;
        syncCount += 1;
        if (syncCount === 1) return firstSync.promise;
        return { ok: true, data: { upserted: 0 } };
      },
    });
    await harness.settle();

    await harness.runTick();
    await harness.runTick();
    current = { id: 'web', collector: { capture: captureWeb } };
    firstSync.resolve({ ok: true, data: { upserted: 0 } });
    await harness.settle();
    await harness.settle();

    expect(captureA).toHaveBeenCalledTimes(1);
    expect(captureWeb).not.toHaveBeenCalled();
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(1);
  });

  it('lets an old durable save finish across restart, then runs the new owner trailing request', async () => {
    const firstSync = deferred<any>();
    let syncCount = 0;
    const captureA = vi.fn(() => makeSnapshot('restart-a', ['A']));
    const captureB = vi.fn(() => makeSnapshot('restart-b', ['B']));
    let current = { id: 'gemini', collector: { capture: captureA } };
    const harness = createHarness({
      snapshots: [makeSnapshot('unused', ['U'])],
      collectorResolver: () => current,
      incrementalImpl: (snapshot) => ({
        changed: true,
        snapshot: {
          ...snapshot,
          conversation: { ...snapshot.conversation },
          messages: [{ ...snapshot.messages[0], messageKey: `${snapshot.conversation.conversationKey}-delta` }],
        },
        diff: { added: [`${snapshot.conversation.conversationKey}-delta`], updated: [], removed: [] },
        commit: () => true,
      }),
      sendImpl: (type: string) => {
        if (type !== 'syncConversationMessages') return undefined;
        syncCount += 1;
        if (syncCount === 1) return firstSync.promise;
        return { ok: true, data: { upserted: 1 } };
      },
    });
    await harness.settle();
    await harness.runTick();
    expect(captureA).toHaveBeenCalledTimes(1);

    current = { id: 'notionai', collector: { capture: captureB } };
    harness.restartResident();
    await harness.settle();
    await harness.runTick();
    expect(captureB).not.toHaveBeenCalled();

    firstSync.resolve({ ok: true, data: { upserted: 1 } });
    await harness.settle();
    await harness.settle();
    expect(captureB).toHaveBeenCalledTimes(1);
    expect(harness.tipCalls).toHaveLength(1);
  });

  it('abandons an old pre-save run after restart and then runs the new owner trailing request', async () => {
    const oldCapture = deferred<any>();
    const captureA = vi.fn(() => oldCapture.promise);
    const captureB = vi.fn(() => makeSnapshot('restart-pre-b', ['B']));
    let current = { id: 'gemini', collector: { capture: captureA } };
    const harness = createHarness({
      snapshots: [makeSnapshot('unused', ['U'])],
      collectorResolver: () => current,
      incrementalImpl: (snapshot) => ({
        changed: true,
        snapshot: {
          ...snapshot,
          conversation: { ...snapshot.conversation },
          messages: [{ ...snapshot.messages[0], messageKey: 'delta' }],
        },
        diff: { added: ['delta'], updated: [], removed: [] },
        commit: () => true,
      }),
    });
    await harness.settle();
    await harness.runTick();

    current = { id: 'notionai', collector: { capture: captureB } };
    harness.restartResident();
    await harness.settle();
    await harness.runTick();
    oldCapture.resolve(makeSnapshot('restart-pre-a', ['A']));
    await harness.settle();
    await harness.settle();

    expect(captureA).toHaveBeenCalledTimes(1);
    expect(captureB).toHaveBeenCalledTimes(1);
    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0].payload.messages.some((m: any) => m.contentText === 'B')).toBe(true);
  });

  it('gives a pending manual save priority over an autosave still awaiting capture', async () => {
    const autoCapture = deferred<any>();
    const manualSnapshot = makeSnapshot('manual-priority', ['Manual']);
    const capture = vi.fn((input?: any) => (input?.manual ? manualSnapshot : autoCapture.promise));
    const harness = createHarness({
      snapshots: [makeSnapshot('unused', ['U'])],
      collectorResolver: () => ({ id: 'gemini', collector: { capture } }),
      incrementalImpl: (snapshot) => ({
        changed: true,
        snapshot: { ...snapshot, conversation: { ...snapshot.conversation }, messages: [] },
        diff: { added: [], updated: [], removed: [] },
        commit: () => true,
      }),
    });
    await harness.settle();
    await harness.runTick();
    const click = harness.getButtonConfig()?.onClick as (() => Promise<void>) | undefined;
    const manualRun = click?.();
    await harness.settle();

    autoCapture.resolve(makeSnapshot('autosave-yield', ['Auto']));
    await manualRun;
    await harness.settle();

    expect(capture).toHaveBeenCalledTimes(2);
    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0].payload.mode).not.toBe('append');
    expect(syncCalls[0].payload.messages.some((m: any) => m.contentText === 'Manual')).toBe(true);
  });

  it.each([true, false])(
    'waits for an already durable autosave to settle before manual persistence (success=%s)',
    async (success) => {
      const autoSync = deferred<any>();
      let syncCount = 0;
      const manualCapture = vi.fn(() => makeSnapshot(`manual-after-durable-${success}`, ['Manual']));
      const autoCapture = vi.fn((input?: any) =>
        input?.manual ? manualCapture() : makeSnapshot('auto-durable', ['Auto']),
      );
      const harness = createHarness({
        snapshots: [makeSnapshot('unused', ['U'])],
        collectorResolver: () => ({ id: 'gemini', collector: { capture: autoCapture } }),
        incrementalImpl: (snapshot) => ({
          changed: true,
          snapshot: {
            ...snapshot,
            conversation: { ...snapshot.conversation },
            messages: [{ ...snapshot.messages[0], messageKey: 'auto-durable-delta' }],
          },
          diff: { added: ['auto-durable-delta'], updated: [], removed: [] },
          commit: () => true,
        }),
        sendImpl: (type: string) => {
          if (type !== 'syncConversationMessages') return undefined;
          syncCount += 1;
          if (syncCount === 1) return autoSync.promise;
          return { ok: true, data: { upserted: 1 } };
        },
      });
      await harness.settle();
      await harness.runTick();
      const click = harness.getButtonConfig()?.onClick as (() => Promise<void>) | undefined;
      const manualRun = click?.();
      await harness.settle();
      expect(manualCapture).not.toHaveBeenCalled();

      autoSync.resolve(
        success ? { ok: true, data: { upserted: 1 } } : { ok: false, error: { message: 'auto failed' } },
      );
      await manualRun;
      await harness.settle();
      expect(manualCapture).toHaveBeenCalledTimes(1);
      expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(2);
    },
  );

  it('coalesces autosave requests while manual persistence is in-flight and drains one trailing append afterwards', async () => {
    const manualSync = deferred<any>();
    let syncCount = 0;
    let prepareCount = 0;
    const page = makeSnapshot('manual-gate', ['A']);
    const capture = vi.fn(() => page);
    const harness = createHarness({
      snapshots: [page],
      tailWindows: [{ conversationId: 1, messages: page.messages }],
      collectorResolver: () => ({ id: 'gemini', collector: { capture } }),
      incrementalImpl: (snapshot) => {
        prepareCount += 1;
        if (prepareCount === 1) {
          return {
            changed: false,
            snapshot: { ...snapshot, conversation: { ...snapshot.conversation }, messages: [] },
            diff: { added: [], updated: [], removed: [] },
            commit: () => true,
          };
        }
        return {
          changed: true,
          snapshot: {
            ...snapshot,
            conversation: { ...snapshot.conversation },
            messages: [{ ...snapshot.messages[0], messageKey: 'after-manual' }],
          },
          diff: { added: ['after-manual'], updated: [], removed: [] },
          commit: () => true,
        };
      },
      sendImpl: (type: string) => {
        if (type !== 'syncConversationMessages') return undefined;
        syncCount += 1;
        if (syncCount === 1) return manualSync.promise;
        return { ok: true, data: { upserted: 1 } };
      },
    });
    await harness.settle();
    await harness.runTick();
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(0);

    const manualRun = (harness.getButtonConfig()?.onClick as (() => Promise<void>) | undefined)?.();
    await harness.settle();
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(1);
    await harness.runTick();
    await harness.runTick();
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(1);

    manualSync.resolve({ ok: true, data: { upserted: 1 } });
    await manualRun;
    await harness.settle();
    await harness.settle();

    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(2);
    expect(syncCalls[0].payload.mode).not.toBe('append');
    expect(syncCalls[1].payload.mode).toBe('append');
    expect(prepareCount).toBe(2);
  });

  it('keeps an old-owner inflight manual exclusive across restart and drains the new-owner autosave trailing afterwards', async () => {
    const manualSync = deferred<any>();
    let syncCount = 0;
    let prepareCount = 0;
    const captureArgs: any[] = [];
    const page = makeSnapshot('manual-inflight-restart', ['A']);
    const capture = vi.fn((input?: any) => {
      captureArgs.push(input || null);
      return page;
    });
    const harness = createHarness({
      snapshots: [page],
      tailWindows: [{ conversationId: 1, messages: page.messages }],
      collectorResolver: () => ({ id: 'gemini', collector: { capture } }),
      incrementalImpl: (snapshot) => {
        prepareCount += 1;
        if (prepareCount === 1) {
          return {
            changed: false,
            snapshot: { ...snapshot, conversation: { ...snapshot.conversation }, messages: [] },
            diff: { added: [], updated: [], removed: [] },
            commit: () => true,
          };
        }
        return {
          changed: true,
          snapshot: {
            ...snapshot,
            conversation: { ...snapshot.conversation },
            messages: [{ ...snapshot.messages[0], messageKey: 'after-restart-manual' }],
          },
          diff: { added: ['after-restart-manual'], updated: [], removed: [] },
          commit: () => true,
        };
      },
      sendImpl: (type: string) => {
        if (type !== 'syncConversationMessages') return undefined;
        syncCount += 1;
        if (syncCount === 1) return manualSync.promise;
        return { ok: true, data: { upserted: 1 } };
      },
    });
    await harness.settle();
    await harness.runTick();
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(0);

    const oldManualRun = (harness.getButtonConfig()?.onClick as (() => Promise<void>) | undefined)?.();
    await harness.settle();
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(1);

    harness.restartResident();
    await harness.settle();
    await harness.runTick();
    const newManualRun = (harness.getButtonConfig()?.onClick as (() => Promise<void>) | undefined)?.();
    await harness.settle();
    expect(captureArgs.filter((input) => input?.manual === true)).toHaveLength(1);
    expect(harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(1);

    manualSync.resolve({ ok: true, data: { upserted: 1 } });
    await oldManualRun;
    await newManualRun;
    await harness.settle();
    await harness.settle();

    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(2);
    expect(syncCalls[0].payload.mode).not.toBe('append');
    expect(syncCalls[1].payload.mode).toBe('append');
    expect(captureArgs.filter((input) => input?.manual === true)).toHaveLength(1);
  });

  it('cancels an old-owner manual pending before capture and lets the new owner manual run', async () => {
    const oldAutoCapture = deferred<any>();
    const captureArgs: any[] = [];
    const capture = vi.fn((input?: any) => {
      captureArgs.push(input || null);
      if (!input?.manual && captureArgs.length === 1) return oldAutoCapture.promise;
      return makeSnapshot('new-owner-manual', ['Manual']);
    });
    const harness = createHarness({
      snapshots: [makeSnapshot('unused', ['U'])],
      collectorResolver: () => ({ id: 'gemini', collector: { capture } }),
      incrementalImpl: (snapshot) => ({
        changed: true,
        snapshot: { ...snapshot, conversation: { ...snapshot.conversation }, messages: [] },
        diff: { added: [], updated: [], removed: [] },
        commit: () => true,
      }),
    });
    await harness.settle();
    await harness.runTick();
    const oldClick = harness.getButtonConfig()?.onClick as (() => Promise<void>) | undefined;
    const oldManualRun = oldClick?.();
    await harness.settle();

    harness.restartResident();
    await harness.settle();
    await harness.runTick();
    const newClick = harness.getButtonConfig()?.onClick as (() => Promise<void>) | undefined;
    const newManualRun = newClick?.();
    await harness.settle();

    oldAutoCapture.resolve(makeSnapshot('old-auto', ['Auto']));
    await oldManualRun;
    await newManualRun;
    await harness.settle();

    const manualCalls = captureArgs.filter((input) => input?.manual === true);
    expect(manualCalls).toHaveLength(1);
    const syncCalls = harness.sendCalls.filter((entry) => entry.type === 'syncConversationMessages');
    expect(syncCalls).toHaveLength(2);
    expect(syncCalls[0].payload.mode).not.toBe('append');
    expect(syncCalls[1].payload.mode).toBe('append');
  });

  it('keeps virtualized providers out of the auto-save source set', () => {
    expect(AI_CHAT_AUTO_SAVE_COLLECTOR_IDS.has('chatgpt')).toBe(false);
    expect(AI_CHAT_AUTO_SAVE_COLLECTOR_IDS.has('googleaistudio')).toBe(false);
  });

  it.each(['chatgpt', 'googleaistudio'])(
    'skips virtualized manual collector %s before capture',
    async (collectorId) => {
      const harness = createHarness({
        snapshots: [makeSnapshot(`manual-${collectorId}`, ['A'])],
        collectorId,
      });

      await harness.runTick();

      expect(harness.getCaptureCount()).toBe(0);
      expect(harness.sendCalls).toHaveLength(0);
    },
  );
});
