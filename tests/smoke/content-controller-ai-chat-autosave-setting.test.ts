import { afterEach, describe, expect, it, vi } from 'vitest';

import { createContentController } from '@services/bootstrap/content-controller';

function deferred<T>() {
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

function installStorage(
  initial: Record<string, any> = {},
  options?: { initialRuntimeSettingsRead?: ReturnType<typeof deferred<Record<string, any>>> },
) {
  const store = { ...initial };
  const listeners = new Set<StorageListener>();
  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys: string[], callback: (value: Record<string, any>) => void) {
          const list = Array.isArray(keys) ? keys : [];
          const isRuntimeSettingsRead =
            list.includes('ai_chat_auto_save_enabled') && list.includes('ai_chat_dollar_mention_enabled');
          if (isRuntimeSettingsRead && options?.initialRuntimeSettingsRead) {
            options.initialRuntimeSettingsRead.promise.then(
              (value) => callback(value),
              (error) => {
                (globalThis.chrome as any).runtime.lastError = {
                  message: String(error?.message || error || 'storage failed'),
                };
                callback({});
                (globalThis.chrome as any).runtime.lastError = null;
              },
            );
            return;
          }
          const result: Record<string, any> = {};
          for (const key of list) result[key] = store[key];
          callback(result);
        },
        set(items: Record<string, any>, callback?: () => void) {
          Object.assign(store, items);
          callback?.();
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
    emit(key: string, newValue: any, areaName = 'local') {
      const oldValue = store[key];
      store[key] = newValue;
      for (const listener of [...listeners]) listener({ [key]: { oldValue, newValue } }, areaName);
    },
    listenerCount: () => listeners.size,
  };
}

function makeSnapshot(key = 'c1') {
  return {
    conversation: { source: 'gemini', conversationKey: key, title: 'Chat' },
    messages: [{ messageKey: 'm1', role: 'user', contentText: 'hello', sequence: 1 }],
  };
}

function createHarness(options: {
  capture?: () => any;
  send?: (type: string, payload?: any) => any;
  incremental?: (snapshot: any) => any;
  collectorId?: string;
  itemMentionStart?: () => { stop?: () => void } | null;
}) {
  let tick: (() => void | Promise<void>) | null = null;
  const observerStart = vi.fn();
  const observerStop = vi.fn();
  const ensureButton = vi.fn();
  const sendCalls: Array<{ type: string; payload?: any }> = [];
  const capture = vi.fn(options.capture || (() => makeSnapshot()));
  const incremental = vi.fn(
    options.incremental ||
      ((snapshot: any) => ({
        changed: true,
        snapshot: { ...snapshot, messages: snapshot.messages },
        diff: { added: ['m1'], updated: [], removed: [] },
      })),
  );
  const runtime = {
    send: async (type: string, payload?: any) => {
      sendCalls.push({ type, payload });
      if (options.send) {
        const custom = await options.send(type, payload);
        if (custom !== undefined) return custom;
      }
      if (type === 'getConversationTailWindowBySourceAndKey') {
        return { ok: true, data: { conversationId: 1, messages: [{ ...makeSnapshot().messages[0] }] } };
      }
      if (type === 'upsertConversation') return { ok: true, data: { id: 1, __isNew: false } };
      if (type === 'syncConversationMessages') return { ok: true, data: { upserted: 1, deleted: 0 } };
      return { ok: true, data: {} };
    },
    isInvalidContextError: () => false,
  };
  const controller = createContentController({
    runtime,
    collectorsRegistry: {
      pickActive: () => ({ id: options.collectorId || 'gemini', collector: { capture } }),
      list: () => [],
    },
    currentPageCapture: { captureCurrentPage: vi.fn() } as any,
    inpageButton: { ensureInpageButton: ensureButton, cleanupButtons: vi.fn(), setSaving: vi.fn() },
    inpageTip: { showSaveTip: vi.fn() },
    runtimeObserver: {
      createObserver: ({ onTick }: { onTick?: () => void | Promise<void> }) => {
        tick = onTick || null;
        return { start: observerStart, stop: observerStop };
      },
    },
    incrementalEngine: {
      prepare: (snapshot: any) => {
        const result = incremental(snapshot) || { changed: false };
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
    itemMention: options.itemMentionStart ? { start: options.itemMentionStart } : null,
  });
  const resident = controller.start();
  return {
    resident,
    capture,
    incremental,
    observerStart,
    observerStop,
    ensureButton,
    sendCalls,
    runTick: async () => {
      if (tick) await tick();
      await flush();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // @ts-expect-error cleanup
  delete globalThis.chrome;
  // @ts-expect-error cleanup
  delete globalThis.document;
});

describe('content-controller auto-save live setting', () => {
  it('starts the observer after an authoritative disabled observation but does not capture', async () => {
    const storage = installStorage({ ai_chat_auto_save_enabled: false, ai_chat_dollar_mention_enabled: false });
    const h = createHarness({});
    await flush();
    expect(storage.listenerCount()).toBe(1);
    expect(h.observerStart).toHaveBeenCalledTimes(1);
    await h.runTick();
    expect(h.ensureButton).toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
    h.resident?.stop?.();
    expect(storage.listenerCount()).toBe(0);
  });

  it('re-enables autosave without reload and later ticks persist', async () => {
    const storage = installStorage({ ai_chat_auto_save_enabled: false });
    const h = createHarness({});
    await flush();
    storage.emit('ai_chat_auto_save_enabled', true);
    await h.runTick();
    expect(h.capture).toHaveBeenCalledTimes(1);
    expect(h.sendCalls.some((entry) => entry.type === 'syncConversationMessages')).toBe(true);
    h.resident?.stop?.();
  });

  it('disable during collector capture prevents backfill/prepare/save', async () => {
    const storage = installStorage({ ai_chat_auto_save_enabled: true });
    const captureDeferred = deferred<any>();
    const h = createHarness({ capture: () => captureDeferred.promise });
    await flush();
    const run = h.runTick();
    await flush();
    expect(h.capture).toHaveBeenCalledTimes(1);
    storage.emit('ai_chat_auto_save_enabled', false);
    captureDeferred.resolve(makeSnapshot());
    await run;
    expect(h.incremental).not.toHaveBeenCalled();
    expect(h.sendCalls.some((entry) => entry.type === 'getConversationTailWindowBySourceAndKey')).toBe(false);
    expect(h.sendCalls.some((entry) => entry.type === 'syncConversationMessages')).toBe(false);
    h.resident?.stop?.();
  });

  it('disable during backfill await rolls back the attempted signature so re-enable can retry after the existing throttle', async () => {
    vi.useFakeTimers();
    const storage = installStorage({ ai_chat_auto_save_enabled: true });
    const firstTail = deferred<any>();
    let tailCalls = 0;
    const h = createHarness({
      send: (type) => {
        if (type !== 'getConversationTailWindowBySourceAndKey') return undefined;
        tailCalls += 1;
        if (tailCalls === 1) return firstTail.promise;
        return { ok: true, data: { conversationId: null, messages: [] } };
      },
      incremental: () => ({ changed: false }),
    });
    await flush();
    const firstRun = h.runTick();
    await flush();
    expect(tailCalls).toBe(1);
    storage.emit('ai_chat_auto_save_enabled', false);
    firstTail.resolve({ ok: true, data: { conversationId: null, messages: [] } });
    await firstRun;
    expect(h.sendCalls.some((entry) => entry.type === 'syncConversationMessages')).toBe(false);

    storage.emit('ai_chat_auto_save_enabled', true);
    await h.runTick();
    expect(tailCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await h.runTick();
    expect(tailCalls).toBe(2);
    expect(h.sendCalls.filter((entry) => entry.type === 'syncConversationMessages')).toHaveLength(1);
    h.resident?.stop?.();
  });

  it('registers the unified listener before initial read and keeps per-key revisions independent', async () => {
    const initialRead = deferred<Record<string, any>>();
    const mentionStart = vi.fn(() => ({ stop: vi.fn() }));
    const storage = installStorage({}, { initialRuntimeSettingsRead: initialRead });
    const h = createHarness({ itemMentionStart: mentionStart });

    expect(storage.listenerCount()).toBe(1);
    expect(h.observerStart).not.toHaveBeenCalled();
    storage.emit('ai_chat_auto_save_enabled', false);
    expect(h.observerStart).toHaveBeenCalledTimes(1);

    initialRead.resolve({ ai_chat_auto_save_enabled: true, ai_chat_dollar_mention_enabled: true });
    await flush();
    expect(h.observerStart).toHaveBeenCalledTimes(1);
    expect(mentionStart).toHaveBeenCalledTimes(1);
    await h.runTick();
    expect(h.capture).not.toHaveBeenCalled();
    h.resident?.stop?.();
  });

  it('a dollar wake cannot invalidate the autosave value from the same pending initial read', async () => {
    const initialRead = deferred<Record<string, any>>();
    const mentionStart = vi.fn(() => ({ stop: vi.fn() }));
    const storage = installStorage({}, { initialRuntimeSettingsRead: initialRead });
    const h = createHarness({ itemMentionStart: mentionStart });

    storage.emit('ai_chat_dollar_mention_enabled', false);
    initialRead.resolve({ ai_chat_auto_save_enabled: true, ai_chat_dollar_mention_enabled: true });
    await flush();
    expect(h.observerStart).toHaveBeenCalledTimes(1);
    expect(mentionStart).not.toHaveBeenCalled();
    await h.runTick();
    expect(h.capture).toHaveBeenCalledTimes(1);
    h.resident?.stop?.();
  });

  it('initial read failure fail-opens only keys that did not receive a newer wake', async () => {
    const initialRead = deferred<Record<string, any>>();
    const mentionStart = vi.fn(() => ({ stop: vi.fn() }));
    const storage = installStorage({}, { initialRuntimeSettingsRead: initialRead });
    const h = createHarness({ itemMentionStart: mentionStart });

    storage.emit('ai_chat_auto_save_enabled', false);
    initialRead.reject(new Error('read failed'));
    await flush();
    expect(h.observerStart).toHaveBeenCalledTimes(1);
    expect(mentionStart).toHaveBeenCalledTimes(1);
    await h.runTick();
    expect(h.capture).not.toHaveBeenCalled();
    h.resident?.stop?.();
  });

  it('resident stop invalidates a pending initial read and prevents late observer/mention startup', async () => {
    const initialRead = deferred<Record<string, any>>();
    const mentionStart = vi.fn(() => ({ stop: vi.fn() }));
    const storage = installStorage({}, { initialRuntimeSettingsRead: initialRead });
    const h = createHarness({ itemMentionStart: mentionStart });

    h.resident?.stop?.();
    expect(storage.listenerCount()).toBe(0);
    initialRead.resolve({ ai_chat_auto_save_enabled: true, ai_chat_dollar_mention_enabled: true });
    await flush();
    expect(h.observerStart).not.toHaveBeenCalled();
    expect(mentionStart).not.toHaveBeenCalled();
  });

  it('a non-local setting change does not settle an unknown autosave observation', async () => {
    const initialRead = deferred<Record<string, any>>();
    const storage = installStorage({}, { initialRuntimeSettingsRead: initialRead });
    const h = createHarness({});

    storage.emit('ai_chat_auto_save_enabled', true, 'sync');
    expect(h.observerStart).not.toHaveBeenCalled();
    initialRead.resolve({ ai_chat_auto_save_enabled: false, ai_chat_dollar_mention_enabled: false });
    await flush();
    expect(h.observerStart).toHaveBeenCalledTimes(1);
    await h.runTick();
    expect(h.capture).not.toHaveBeenCalled();
    h.resident?.stop?.();
  });

  it('disabling autosave clears queued NotionAI proactive capture timers', async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, EventListener>();
    // @ts-expect-error test document
    globalThis.document = {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string, listener: EventListener) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };
    const storage = installStorage({ ai_chat_auto_save_enabled: true, ai_chat_dollar_mention_enabled: false });
    const h = createHarness({ collectorId: 'notionai' });
    await flush();

    const clickListener = listeners.get('click');
    expect(clickListener).toBeTypeOf('function');
    clickListener?.({
      target: {
        closest(selector: string) {
          return selector.includes('agent-send-message-button') ? {} : null;
        },
      },
    } as any);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    storage.emit('ai_chat_auto_save_enabled', false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(h.capture).not.toHaveBeenCalled();
    h.resident?.stop?.();
  });
});
