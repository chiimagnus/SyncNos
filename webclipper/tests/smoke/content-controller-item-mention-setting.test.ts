import { afterEach, describe, expect, it, vi } from 'vitest';

import { createContentController } from '@services/bootstrap/content-controller.ts';

type StorageChangeListener = (changes: Record<string, any>, areaName?: string) => void;

function installChromeStorageLocalMock(initial?: Record<string, any>) {
  const store: Record<string, any> = { ...(initial || {}) };
  const storageListeners = new Set<StorageChangeListener>();

  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get: (keys: any, cb: any) => {
          const list = Array.isArray(keys) ? keys : [];
          const res: Record<string, any> = {};
          for (const k of list) res[k] = store[k];
          cb(res);
        },
        set: (items: any, cb: any) => {
          Object.assign(store, items || {});
          cb?.();
        },
      },
      onChanged: {
        addListener: (listener: StorageChangeListener) => storageListeners.add(listener),
        removeListener: (listener: StorageChangeListener) => storageListeners.delete(listener),
      },
    },
  };

  function emitChange(key: string, nextValue: any) {
    const prevValue = store[key];
    store[key] = nextValue;
    const changes = {
      [key]: { oldValue: prevValue, newValue: nextValue },
    };
    for (const listener of Array.from(storageListeners)) listener(changes, 'local');
  }

  return {
    store,
    emitChange,
    getListenerCount: () => storageListeners.size,
    cleanup() {
      // @ts-expect-error cleanup
      delete globalThis.chrome;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('content-controller item mention setting', () => {
  it('does not start item mention controller when disabled', async () => {
    const mock = installChromeStorageLocalMock({ ai_chat_dollar_mention_enabled: false });

    const start = vi.fn(() => ({ stop: vi.fn() }));
    const controller = createContentController({
      runtime: { onInvalidated: () => () => {} },
      collectorsRegistry: null,
      currentPageCapture: {} as any,
      inpageButton: null,
      inpageTip: null,
      runtimeObserver: null,
      incrementalUpdater: null,
      notionAiModelPicker: null,
      itemMention: { start },
    } as any);

    const active = controller.start();
    await Promise.resolve();

    expect(start).toHaveBeenCalledTimes(0);

    active?.stop?.();
    mock.cleanup();
  });

  it('starts and stops item mention controller when toggled', async () => {
    const mock = installChromeStorageLocalMock({ ai_chat_dollar_mention_enabled: false });

    const stopFn = vi.fn();
    const start = vi.fn(() => ({ stop: stopFn }));
    const controller = createContentController({
      runtime: { onInvalidated: () => () => {} },
      collectorsRegistry: null,
      currentPageCapture: {} as any,
      inpageButton: null,
      inpageTip: null,
      runtimeObserver: null,
      incrementalUpdater: null,
      notionAiModelPicker: null,
      itemMention: { start },
    } as any);

    const active = controller.start();
    await Promise.resolve();

    expect(start).toHaveBeenCalledTimes(0);
    expect(mock.getListenerCount()).toBe(1);

    mock.emitChange('ai_chat_dollar_mention_enabled', true);
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(1);

    mock.emitChange('ai_chat_dollar_mention_enabled', false);
    await Promise.resolve();
    expect(stopFn).toHaveBeenCalledTimes(1);

    active?.stop?.();
    expect(mock.getListenerCount()).toBe(0);
    mock.cleanup();
  });
});
