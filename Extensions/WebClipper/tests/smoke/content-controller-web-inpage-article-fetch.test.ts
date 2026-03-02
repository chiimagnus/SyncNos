import { afterEach, describe, expect, it, vi } from "vitest";
import { createContentController } from "../../src/bootstrap/content-controller.ts";

type TickFn = (() => Promise<void>) | null;

function createHarness(options?: { sendImpl?: (type: string, payload?: any) => Promise<any> }) {
  let tickRef: TickFn = null;
  let buttonConfig: any = null;
  const tipCalls: any[] = [];
  const sendCalls: Array<{ type: string; payload?: any }> = [];

  // @ts-expect-error test global (needed by getInpageCollector)
  globalThis.location = { href: "https://example.com/post", hostname: "example.com", pathname: "/post" };

  const runtime = {
    send: async (type: string, payload?: any) => {
      sendCalls.push({ type, payload });
      if (typeof options?.sendImpl === "function") return options.sendImpl(type, payload);
      return { ok: true, data: {} };
    },
    onInvalidated: () => () => {},
    isInvalidContextError: () => false
  };

  const controller = createContentController({
    runtime,
    collectorsRegistry: {
      pickActive: () => null,
      list: () => [{
        id: "web",
        matches: () => true,
        inpageMatches: () => true,
        collector: { capture: () => null }
      }]
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
    runtimeObserver: {
      createObserver: ({ onTick }: { onTick: () => Promise<void> }) => {
        tickRef = onTick;
        return { start: () => {}, stop: () => {} };
      }
    },
    incrementalUpdater: null,
    notionAiModelPicker: null,
  });
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
  delete globalThis.location;
  // @ts-expect-error cleanup
  delete globalThis.chrome;
});

describe("content-controller web inpage fetch", () => {
  it("routes single-click save to background article fetch for web collector", async () => {
    const harness = createHarness({
      sendImpl: async (type: string) => {
        if (type === "fetchActiveTabArticle") return { ok: true, data: { conversationId: 11 } };
        return { ok: true, data: {} };
      }
    });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(cfg?.collectorId).toBe("web");
    expect(typeof cfg?.onClick).toBe("function");

    await cfg.onClick();

    expect(harness.sendCalls.some((c) => c.type === "fetchActiveTabArticle")).toBe(true);
    expect(harness.tipCalls.some((c) => c.opts?.kind === "ok")).toBe(true);
  });
});
