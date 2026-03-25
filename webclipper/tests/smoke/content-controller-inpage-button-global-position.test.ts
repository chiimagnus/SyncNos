import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContentController } from '@services/bootstrap/content-controller.ts';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture.ts';
import { INPAGE_BUTTON_GLOBAL_POSITION_STORAGE_KEY } from '@platform/storage/inpage-button-position.ts';

type TickFn = (() => void | Promise<void>) | null;

function installChromeStorageLocalMock(initial?: Record<string, any>) {
  const store: Record<string, any> = { ...(initial || {}) };
  const setCalls: any[] = [];

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

function createHarness(options?: { collectorId?: string }) {
  let tickRef: TickFn = null;
  let buttonConfig: any = null;

  const runtime = {
    send: async () => ({ ok: true, data: {} }),
    onInvalidated: () => () => {},
    isInvalidContextError: () => false,
  };

  const collectorsRegistry = {
    pickActive: () => ({ id: options?.collectorId || 'gemini', collector: { capture: () => null } }),
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
      ensureInpageButton: (cfg: any) => {
        buttonConfig = cfg;
      },
      cleanupButtons: () => {},
    },
    runtimeObserver: {
      createObserver: ({ onTick }: { onTick?: () => void | Promise<void> }) => {
        tickRef = onTick || null;
        return { start: () => {}, stop: () => {} };
      },
    },
    incrementalUpdater: null,
    notionAiModelPicker: null,
  });
  controller.start();

  return {
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

  // Legacy per-origin `localStorage` positions were removed when switching to a global position source of truth.
});
