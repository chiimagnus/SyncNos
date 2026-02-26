import { afterEach, describe, expect, it, vi } from "vitest";

type TickFn = (() => Promise<void>) | null;

function loadContentController() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/bootstrap/content-controller.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/bootstrap/content-controller.js");
}

function createHarness(options?: {
  sendImpl?: (type: string, payload?: any) => Promise<any>;
  captureImpl?: (args?: any) => any;
  incrementalImpl?: (snapshot: any) => any;
}) {
  let tickRef: TickFn = null;
  let buttonConfig: any = null;

  const tipCalls: any[] = [];
  const sendCalls: Array<{ type: string; payload?: any }> = [];

  const collector = {
    capture: (args?: any) => {
      if (typeof options?.captureImpl === "function") return options.captureImpl(args);
      return null;
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
      showSaveTip: (text: string, opts: any) => {
        tipCalls.push({ text, opts });
      }
    },
    inpageButton: {
      ensureInpageButton: (cfg: any) => {
        buttonConfig = cfg;
      },
      cleanupButtons: () => {},
    },
    collectorsRegistry: {
      pickActive: () => ({ id: "gemini", collector }),
      list: () => []
    },
    runtimeObserver: {
      createObserver: ({ onTick }: { onTick: () => Promise<void> }) => {
        tickRef = onTick;
        return { start: () => {}, stop: () => {} };
      }
    },
    incrementalUpdater: {
      computeIncremental: (snapshot: any) => {
        if (typeof options?.incrementalImpl === "function") return options.incrementalImpl(snapshot);
        return { changed: false };
      }
    }
  };

  const runtime = {
    send: async (type: string, payload?: any) => {
      sendCalls.push({ type, payload });
      if (typeof options?.sendImpl === "function") return options.sendImpl(type, payload);
      return { ok: true, data: {} };
    },
    onInvalidated: () => () => {},
    isInvalidContextError: () => false
  };

  const api = loadContentController();
  const controller = api.createController({ runtime });
  controller.start();

  return {
    tipCalls,
    sendCalls,
    runTick: async () => {
      if (tickRef) await tickRef();
    },
    getButtonConfig: () => buttonConfig,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error cleanup
  delete globalThis.WebClipper;
});

describe("content-controller inpage combo", () => {
  it("does not show fallback tip when popup open succeeds", async () => {
    const harness = createHarness({
      sendImpl: async (type: string) => {
        if (type === "openExtensionPopup") return { ok: true, data: { opened: true } };
        return { ok: true, data: {} };
      }
    });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onDoubleClick).toBe("function");

    await cfg.onDoubleClick();

    expect(harness.tipCalls.some((c) => String(c.text).includes("toolbar icon"))).toBe(false);
  });

  it("shows fallback tip when popup open fails", async () => {
    const harness = createHarness({
      sendImpl: async (type: string) => {
        if (type === "openExtensionPopup") return { ok: false, error: { message: "unsupported" } };
        return { ok: true, data: {} };
      }
    });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onDoubleClick).toBe("function");

    await cfg.onDoubleClick();

    expect(harness.tipCalls.some((c) => String(c.text).includes("toolbar icon"))).toBe(true);
  });

  it("emits easter-egg line for combo callback", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const harness = createHarness();

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onCombo).toBe("function");

    cfg.onCombo({ level: 7, count: 7 });
    expect(harness.tipCalls.some((c) => String(c.text).includes("Combo x7"))).toBe(true);
  });

  it("keeps single click save flow for manual capture", async () => {
    const harness = createHarness({
      captureImpl: (args) => {
        if (!args || !args.manual) return null;
        return {
          conversation: { source: "gemini", conversationKey: "k1" },
          messages: [{ messageKey: "m1", sequence: 1, role: "user", contentText: "hi" }]
        };
      },
      sendImpl: async (type: string) => {
        if (type === "upsertConversation") return { ok: true, data: { id: 11 } };
        if (type === "syncConversationMessages") return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      }
    });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onClick).toBe("function");

    await cfg.onClick();

    expect(harness.sendCalls.some((c) => c.type === "upsertConversation")).toBe(true);
    expect(harness.sendCalls.some((c) => c.type === "syncConversationMessages")).toBe(true);
    expect(harness.tipCalls.some((c) => c.opts?.kind === "ok")).toBe(true);
  });

  it("shows tip when auto incremental save succeeds", async () => {
    const snapshot = {
      conversation: { source: "gemini", conversationKey: "auto-1" },
      messages: [{ messageKey: "m1", sequence: 1, role: "user", contentText: "hello" }]
    };

    const harness = createHarness({
      captureImpl: () => snapshot,
      incrementalImpl: (snap) => ({ changed: true, snapshot: snap }),
      sendImpl: async (type: string) => {
        if (type === "upsertConversation") return { ok: true, data: { id: 22 } };
        if (type === "syncConversationMessages") return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      }
    });

    await harness.runTick();

    expect(harness.sendCalls.some((c) => c.type === "upsertConversation")).toBe(true);
    expect(harness.sendCalls.some((c) => c.type === "syncConversationMessages")).toBe(true);
    expect(harness.tipCalls.some((c) => String(c.text) === "Saved")).toBe(true);
  });
});
