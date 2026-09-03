import { afterEach, describe, expect, it, vi } from 'vitest';

import { createContentController } from '@services/bootstrap/content-controller';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

type StorageListener = (changes: Record<string, any>, areaName: string) => void;

function installStorage(initial: Record<string, any> = {}) {
  const store = { ...initial };
  const listeners = new Set<StorageListener>();
  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys: string[], callback: (value: Record<string, any>) => void) {
          const result: Record<string, any> = {};
          for (const key of Array.isArray(keys) ? keys : []) result[key] = store[key];
          callback(result);
        },
      },
      onChanged: {
        addListener(listener: StorageListener) {
          listeners.add(listener);
        },
        removeListener(listener: StorageListener) {
          listeners.delete(listener);
        },
      },
    },
  };
  return {
    emit(key: string, newValue: any) {
      const oldValue = store[key];
      store[key] = newValue;
      for (const listener of [...listeners]) listener({ [key]: { oldValue, newValue } }, 'local');
    },
    listenerCount: () => listeners.size,
  };
}

function makeSnapshot() {
  return {
    conversation: { source: 'gemini', conversationKey: 'c1', title: 'Chat' },
    messages: [{ messageKey: 'm1', role: 'user', contentText: 'hello', sequence: 1 }],
  };
}

function createHarness(options?: {
  manualCaptures?: Array<ReturnType<typeof deferred<void>>>;
  mentionStart?: ReturnType<typeof vi.fn>;
}) {
  const observerTicks: Array<() => void | Promise<void>> = [];
  const observerStops: Array<ReturnType<typeof vi.fn>> = [];
  const buttonConfigs: any[] = [];
  const savingCalls: boolean[] = [];
  const tipCalls: string[] = [];
  const capture = vi.fn(() => makeSnapshot());
  let manualIndex = 0;
  const progressCallbacks: Array<(progress: any) => void> = [];

  const controller = createContentController({
    runtime: {
      send: async (type: string) => {
        if (type === 'getConversationTailWindowBySourceAndKey') {
          return { ok: true, data: { conversationId: 1, messages: makeSnapshot().messages } };
        }
        if (type === 'upsertConversation') return { ok: true, data: { id: 1, __isNew: false } };
        if (type === 'syncConversationMessages') return { ok: true, data: { upserted: 1 } };
        return { ok: true, data: {} };
      },
      isInvalidContextError: () => false,
    },
    collectorsRegistry: {
      pickActive: () => ({ id: 'gemini', collector: { capture } }),
      list: () => [],
    },
    currentPageCapture: {
      captureCurrentPage: vi.fn(async (input: any) => {
        progressCallbacks.push(input?.onProgress);
        const pending = options?.manualCaptures?.[manualIndex++];
        if (pending) await pending.promise;
      }),
    } as any,
    inpageButton: {
      ensureInpageButton: (config: any) => buttonConfigs.push(config),
      cleanupButtons: vi.fn(),
      setSaving: (saving: boolean) => savingCalls.push(saving),
    },
    inpageTip: {
      showSaveTip: (text: unknown) => tipCalls.push(String(text || '')),
    },
    runtimeObserver: {
      createObserver: ({ onTick }: { onTick?: () => void | Promise<void> }) => {
        observerTicks.push(onTick || (() => {}));
        const stop = vi.fn();
        observerStops.push(stop);
        return { start: vi.fn(), stop };
      },
    },
    incrementalEngine: {
      prepare: (snapshot: any) => ({
        changed: false,
        snapshot: { ...snapshot, conversation: { ...(snapshot?.conversation || {}) }, messages: [] },
        diff: { added: [], updated: [], removed: [] },
        commit: () => true,
      }),
    },
    itemMention: options?.mentionStart ? { start: options.mentionStart } : null,
  });

  return {
    controller,
    capture,
    observerTicks,
    observerStops,
    buttonConfigs,
    savingCalls,
    tipCalls,
    progressCallbacks,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error cleanup
  delete globalThis.chrome;
});

describe('content-controller resident lifecycle', () => {
  it('returns the unified storage listener to baseline on every stop', async () => {
    const storage = installStorage({ ai_chat_auto_save_enabled: false, ai_chat_dollar_mention_enabled: false });
    const h = createHarness();

    for (let i = 0; i < 3; i += 1) {
      const resident = h.controller.start();
      expect(storage.listenerCount()).toBe(1);
      await flush();
      resident?.stop?.();
      expect(storage.listenerCount()).toBe(0);
      resident?.stop?.();
      expect(storage.listenerCount()).toBe(0);
    }

    expect(h.observerStops).toHaveLength(3);
    expect(h.observerStops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
  });

  it('only the current restarted resident responds to setting wakes', async () => {
    const storage = installStorage({ ai_chat_auto_save_enabled: false, ai_chat_dollar_mention_enabled: false });
    const currentMentionStop = vi.fn();
    const mentionStart = vi.fn(() => ({ stop: currentMentionStop }));
    const h = createHarness({ mentionStart });

    const oldResident = h.controller.start();
    await flush();
    oldResident?.stop?.();
    const currentResident = h.controller.start();
    await flush();

    storage.emit('ai_chat_dollar_mention_enabled', true);
    await flush();
    expect(mentionStart).toHaveBeenCalledTimes(1);

    storage.emit('ai_chat_dollar_mention_enabled', false);
    await flush();
    expect(currentMentionStop).toHaveBeenCalledTimes(1);

    currentResident?.stop?.();
    expect(storage.listenerCount()).toBe(0);
  });

  it('a stale observer callback from a stopped resident cannot autosave', async () => {
    installStorage({ ai_chat_auto_save_enabled: true, ai_chat_dollar_mention_enabled: false });
    const h = createHarness();
    const oldResident = h.controller.start();
    await flush();
    expect(h.observerTicks).toHaveLength(1);
    oldResident?.stop?.();

    const currentResident = h.controller.start();
    await flush();
    expect(h.observerTicks).toHaveLength(2);

    await h.observerTicks[0]?.();
    expect(h.capture).not.toHaveBeenCalled();

    currentResident?.stop?.();
  });

  it('old manual progress/finally cannot overwrite a new resident saving state', async () => {
    installStorage({ ai_chat_auto_save_enabled: false, ai_chat_dollar_mention_enabled: false });
    const oldManual = deferred<void>();
    const newManual = deferred<void>();
    const h = createHarness({ manualCaptures: [oldManual, newManual] });

    const oldResident = h.controller.start();
    await flush();
    await h.observerTicks[0]?.();
    const oldClick = h.buttonConfigs.at(-1)?.onClick as (() => Promise<void>) | undefined;
    expect(oldClick).toBeTypeOf('function');
    const oldRun = oldClick?.();
    await flush();
    expect(h.savingCalls.at(-1)).toBe(true);

    oldResident?.stop?.();
    expect(h.savingCalls.at(-1)).toBe(false);

    const currentResident = h.controller.start();
    await flush();
    await h.observerTicks[1]?.();
    const newClick = h.buttonConfigs.at(-1)?.onClick as (() => Promise<void>) | undefined;
    await newClick?.();
    await flush();
    expect(h.progressCallbacks).toHaveLength(1);
    expect(h.savingCalls.at(-1)).toBe(false);

    h.progressCallbacks[0]?.({ message: 'stale progress', kind: 'default' });
    oldManual.resolve();
    await oldRun;
    expect(h.tipCalls).not.toContain('stale progress');

    const newRun = newClick?.();
    await flush();
    expect(h.progressCallbacks).toHaveLength(2);
    expect(h.savingCalls.at(-1)).toBe(true);
    newManual.resolve();
    await newRun;
    expect(h.savingCalls.at(-1)).toBe(false);
    currentResident?.stop?.();
  });
});
