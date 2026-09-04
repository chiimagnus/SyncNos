import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContentController } from '@services/bootstrap/content-controller.ts';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture.ts';
import { INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY } from '@platform/storage/inpage-button-position.ts';
import { createAutoSaveIncrementalEngine } from '@services/conversations/content/autosave-incremental-engine.ts';

type TickFn = (() => void | Promise<void>) | null;

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

function installChromeStorageLocalMock(
  initial?: Record<string, any>,
  options?: { positionRead?: ReturnType<typeof deferred<Record<string, any>>> },
) {
  const store: Record<string, any> = { ...(initial || {}) };
  const setCalls: any[] = [];

  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get: (keys: any, cb: any) => {
          const list = Array.isArray(keys) ? keys : [];
          if (list.includes(INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY) && options?.positionRead) {
            options.positionRead.promise.then(cb);
            return;
          }
          const res: Record<string, any> = {};
          for (const k of list) res[k] = store[k];
          cb(res);
        },
        set: (items: any, cb: any) => {
          setCalls.push(items);
          Object.assign(store, items || {});
          cb?.();
        },
        remove: (_keys: any, cb: any) => {
          cb?.();
        },
      },
    },
  };

  return {
    store,
    setCalls,
    cleanup() {
      // @ts-expect-error cleanup
      delete globalThis.chrome;
    },
  };
}

function createHarness(options?: {
  collectorId?: string;
  getCollectorId?: () => string;
  onEnsureButton?: (config: any) => void;
}) {
  let tickRef: TickFn = null;
  let buttonConfig: any = null;
  const ensureButton = vi.fn((config: any) => {
    buttonConfig = config;
    options?.onEnsureButton?.(config);
  });
  const cleanupButtons = vi.fn();
  const capture = vi.fn(() => null);

  const runtime = {
    send: async () => ({ ok: true, data: {} }),
    onInvalidated: () => () => {},
    isInvalidContextError: () => false,
  };

  const collectorsRegistry = {
    pickActive: () => ({ id: options?.getCollectorId?.() || options?.collectorId || 'gemini', collector: { capture } }),
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
      ensureInpageButton: ensureButton,
      cleanupButtons,
    },
    createRuntimeObserver: ({ onTick }: { onTick?: () => void | Promise<void> }) => {
      tickRef = onTick || null;
      return { start: () => {}, stop: () => {} };
    },
    incrementalEngine: createAutoSaveIncrementalEngine(),
  });
  const resident = controller.start();

  return {
    resident,
    capture,
    ensureButton,
    cleanupButtons,
    runTick: async () => {
      if (tickRef) await tickRef();
    },
    getButtonConfig: () => buttonConfig,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('content-controller inpage button global position', () => {
  it('injects global position state into inpage button config', async () => {
    const mock = installChromeStorageLocalMock({
      [INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY]: { edge: 'left', ratio: 0.25 },
    });
    const harness = createHarness({ collectorId: 'gemini' });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(cfg?.collectorId).toBe('gemini');
    expect(cfg?.positionState).toEqual({ edge: 'left', ratio: 0.25 });

    mock.cleanup();
  });

  it('persists new position into global store when ui reports a change', async () => {
    const mock = installChromeStorageLocalMock({
      [INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY]: { edge: 'right', ratio: 0.1 },
    });
    const harness = createHarness({ collectorId: 'gemini' });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onPositionChange).toBe('function');

    cfg.onPositionChange({ edge: 'right', ratio: 0.5 });
    await Promise.resolve();

    const lastSet = mock.setCalls.at(-1) || {};
    expect(lastSet[INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY]).toEqual({ edge: 'right', ratio: 0.5 });
    expect(mock.store[INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY]).toEqual({ edge: 'right', ratio: 0.5 });

    mock.cleanup();
  });

  it('does not recreate the button after stop while the global position read is pending', async () => {
    const positionRead = deferred<Record<string, any>>();
    const mock = installChromeStorageLocalMock(
      { ai_chat_auto_save_enabled: false, ai_chat_dollar_mention_enabled: false },
      { positionRead },
    );
    const harness = createHarness({ collectorId: 'gemini' });
    await flush();

    const tick = harness.runTick();
    await flush();
    harness.resident?.stop?.();
    positionRead.resolve({ [INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY]: { edge: 'left', ratio: 0.4 } });
    await tick;

    expect(harness.ensureButton).not.toHaveBeenCalled();
    mock.cleanup();
  });

  it('re-resolves the active collector after the global position await', async () => {
    const positionRead = deferred<Record<string, any>>();
    const mock = installChromeStorageLocalMock(
      { ai_chat_auto_save_enabled: false, ai_chat_dollar_mention_enabled: false },
      { positionRead },
    );
    let collectorId = 'collector-a';
    const harness = createHarness({ getCollectorId: () => collectorId });
    await flush();

    const tick = harness.runTick();
    await flush();
    collectorId = 'collector-b';
    positionRead.resolve({ [INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY]: { edge: 'right', ratio: 0.6 } });
    await tick;

    expect(harness.getButtonConfig()?.collectorId).toBe('collector-b');
    expect(harness.capture).not.toHaveBeenCalled();
    harness.resident?.stop?.();
    mock.cleanup();
  });

  it('cleans a button created during a synchronous stop re-entry and aborts autosave', async () => {
    const mock = installChromeStorageLocalMock({
      ai_chat_auto_save_enabled: true,
      ai_chat_dollar_mention_enabled: false,
      [INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY]: { edge: 'right', ratio: 0.2 },
    });
    let resident: { stop?: () => void } | null = null;
    const harness = createHarness({
      collectorId: 'gemini',
      onEnsureButton: () => resident?.stop?.(),
    });
    resident = harness.resident;
    await flush();

    await harness.runTick();
    expect(harness.ensureButton).toHaveBeenCalledTimes(1);
    expect(harness.cleanupButtons.mock.calls.some((args) => args[0] === '')).toBe(true);
    expect(harness.capture).not.toHaveBeenCalled();
    mock.cleanup();
  });

  it('keeps button refresh active while autosave is disabled', async () => {
    const mock = installChromeStorageLocalMock({
      ai_chat_auto_save_enabled: false,
      ai_chat_dollar_mention_enabled: false,
      [INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY]: { edge: 'left', ratio: 0.3 },
    });
    const harness = createHarness({ collectorId: 'gemini' });
    await flush();

    await harness.runTick();
    expect(harness.ensureButton).toHaveBeenCalledTimes(1);
    expect(harness.capture).not.toHaveBeenCalled();
    harness.resident?.stop?.();
    mock.cleanup();
  });

  // Legacy per-origin `localStorage` positions were removed when switching to a global position source of truth.
});
