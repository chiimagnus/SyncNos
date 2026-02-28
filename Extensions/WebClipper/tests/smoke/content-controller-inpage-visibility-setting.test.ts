import { afterEach, describe, expect, it, vi } from "vitest";

type TickFn = (() => Promise<void>) | null;
type StorageListener = ((changes: Record<string, any>, areaName: string) => void) | null;

function loadContentController() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/bootstrap/content-controller.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/bootstrap/content-controller.js");
}

function createHarness(options?: { initialSetting?: boolean }) {
  let tickRef: TickFn = null;
  let buttonConfig: any = null;
  let storageListener: StorageListener = null;

  // @ts-expect-error test global
  globalThis.location = { href: "https://example.com/post", hostname: "example.com", pathname: "/post" };

  // @ts-expect-error test global
  globalThis.chrome = {
    storage: {
      local: {
        get: (_keys: any, cb: (value: Record<string, any>) => void) => {
          if (typeof options?.initialSetting === "boolean") {
            cb({ inpage_supported_only: options.initialSetting });
            return;
          }
          cb({});
        }
      },
      onChanged: {
        addListener: (fn: StorageListener) => {
          storageListener = fn;
        },
        removeListener: (_fn: StorageListener) => {}
      }
    }
  };

  // @ts-expect-error test global
  globalThis.WebClipper = {
    messageContracts: {
      CORE_MESSAGE_TYPES: {
        UPSERT_CONVERSATION: "upsertConversation",
        SYNC_CONVERSATION_MESSAGES: "syncConversationMessages"
      },
      UI_MESSAGE_TYPES: {
        OPEN_EXTENSION_POPUP: "openExtensionPopup"
      }
    },
    inpageTip: {
      showSaveTip: () => {}
    },
    inpageButton: {
      ensureInpageButton: (cfg: any) => {
        buttonConfig = cfg;
      },
      cleanupButtons: () => {},
    },
    collectorsRegistry: {
      pickActive: () => null,
      list: () => [{
        id: "web",
        matches: () => true,
        inpageMatches: () => true,
        collector: { capture: () => null }
      }]
    },
    runtimeObserver: {
      createObserver: ({ onTick }: { onTick: () => Promise<void> }) => {
        tickRef = onTick;
        return { start: () => {}, stop: () => {} };
      }
    }
  };

  const runtime = {
    send: async () => ({ ok: true, data: {} }),
    onInvalidated: () => () => {},
    isInvalidContextError: () => false
  };

  const api = loadContentController();
  const wrapper = api.createController({ runtime });
  const controller = wrapper.start();

  return {
    controller,
    runTick: async () => {
      await Promise.resolve();
      await Promise.resolve();
      if (tickRef) await tickRef();
    },
    getButtonConfig: () => buttonConfig,
    emitSettingChanged: (nextValue: boolean) => {
      if (!storageListener) return;
      storageListener({ inpage_supported_only: { oldValue: !nextValue, newValue: nextValue } }, "local");
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error cleanup
  delete globalThis.WebClipper;
  // @ts-expect-error cleanup
  delete globalThis.location;
  // @ts-expect-error cleanup
  delete globalThis.chrome;
});

describe("content-controller inpage visibility setting", () => {
  it("defaults to showing web inpage button when setting is missing", async () => {
    const harness = createHarness();
    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(cfg?.collectorId).toBe("web");
  });

  it("hides web inpage button when inpage_supported_only is true", async () => {
    const harness = createHarness({ initialSetting: true });
    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(cfg?.collectorId).toBeUndefined();
  });

  it("applies storage onChanged updates immediately", async () => {
    const harness = createHarness({ initialSetting: false });
    await harness.runTick();
    expect(harness.getButtonConfig()?.collectorId).toBe("web");

    harness.emitSettingChanged(true);
    expect(harness.getButtonConfig()?.collectorId).toBeUndefined();

    await harness.runTick();
    expect(harness.getButtonConfig()?.collectorId).toBeUndefined();

    harness.emitSettingChanged(false);
    await harness.runTick();
    expect(harness.getButtonConfig()?.collectorId).toBe("web");
  });
});
