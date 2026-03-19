import { afterEach, describe, expect, it, vi } from "vitest";
import { createContentController } from "../../src/bootstrap/content-controller.ts";
import { createCurrentPageCaptureService } from "../../src/bootstrap/current-page-capture.ts";

type TickFn = (() => Promise<void>) | null;

function createHarness(options?: {
  sendImpl?: (type: string, payload?: any) => Promise<any>;
  captureImpl?: (args?: any) => any;
  incrementalImpl?: (snapshot: any) => any;
  collectorId?: string;
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

  const runtime = {
    send: async (type: string, payload?: any) => {
      sendCalls.push({ type, payload });
      if (typeof options?.sendImpl === "function") return options.sendImpl(type, payload);
      return { ok: true, data: {} };
    },
    onInvalidated: () => () => {},
    isInvalidContextError: () => false
  };

  const collectorsRegistry = {
    pickActive: () => ({ id: options?.collectorId || "gemini", collector }),
    list: () => []
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
    incrementalUpdater: {
      computeIncremental: (snapshot: any) => {
        if (typeof options?.incrementalImpl === "function") return options.incrementalImpl(snapshot);
        return { changed: false };
      }
    },
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
});

describe("content-controller inpage combo", () => {
  it("does not show fallback tip when comments sidebar open succeeds", async () => {
    const harness = createHarness({
      sendImpl: async (type: string) => {
        if (type === "openCurrentTabInpageCommentsPanel") return { ok: true, data: { opened: true } };
        return { ok: true, data: {} };
      }
    });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onDoubleClick).toBe("function");

    await cfg.onDoubleClick();

    expect(harness.sendCalls.some((c) => c.type === "openCurrentTabInpageCommentsPanel")).toBe(true);
    expect(harness.tipCalls.some((c) => String(c.text).includes("comments sidebar"))).toBe(false);
  });

  it("shows fallback tip when comments sidebar open fails", async () => {
    const harness = createHarness({
      sendImpl: async (type: string) => {
        if (type === "openCurrentTabInpageCommentsPanel") return { ok: false, error: { message: "unsupported" } };
        return { ok: true, data: {} };
      }
    });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onDoubleClick).toBe("function");

    await cfg.onDoubleClick();

    expect(harness.sendCalls.some((c) => c.type === "openCurrentTabInpageCommentsPanel")).toBe(true);
    expect(harness.tipCalls.some((c) => String(c.text).includes("comments sidebar"))).toBe(true);
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
    expect(harness.tipCalls.some((c) => c.opts?.kind === "default")).toBe(true);
  });

  it("shows error tip when manual capture finds no visible conversation", async () => {
    const harness = createHarness({
      captureImpl: (args) => {
        if (!args || !args.manual) return null;
        return null;
      }
    });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onClick).toBe("function");

    await cfg.onClick();

    expect(harness.tipCalls.some((c) => String(c.text).includes("No visible conversation"))).toBe(true);
    expect(harness.tipCalls.some((c) => c.opts?.kind === "ok")).toBe(false);
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

  it("skips auto-save when chatgpt deep research message is still a placeholder", async () => {
    const snapshot = {
      conversation: { source: "chatgpt", conversationKey: "auto-dr-placeholder-1" },
      messages: [
        {
          role: "assistant",
          contentText:
            "Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop",
          contentMarkdown:
            "Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop",
        },
      ],
    };

    const harness = createHarness({
      collectorId: "chatgpt",
      captureImpl: () => snapshot,
      incrementalImpl: () => {
        throw new Error("incremental should not run when placeholder is present");
      },
    });

    await harness.runTick();

    expect(harness.sendCalls.some((c) => c.type === "upsertConversation")).toBe(false);
    expect(harness.sendCalls.some((c) => c.type === "syncConversationMessages")).toBe(false);
    expect(harness.tipCalls.length).toBe(0);
  });

  it("auto-saves chatgpt deep research once hydration becomes available", async () => {
    vi.useFakeTimers();

    const snapshot = {
      conversation: { source: "chatgpt", conversationKey: "auto-dr-hydrate-1" },
      messages: [
        {
          role: "assistant",
          contentText:
            "Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop",
          contentMarkdown:
            "Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop",
        },
      ],
    };

    let extractCalls = 0;
    const harness = createHarness({
      collectorId: "chatgpt",
      captureImpl: () => snapshot,
      incrementalImpl: (snap) => {
        expect(String(snap?.messages?.[0]?.contentText || "")).not.toMatch(/^Deep Research \(iframe\):/);
        return { changed: true, snapshot: snap };
      },
      sendImpl: async (type: string, payload?: any) => {
        if (type === "chatgptExtractDeepResearch") {
          extractCalls += 1;
          if (extractCalls === 1) return { ok: true, data: { items: [] } };
          return {
            ok: true,
            data: {
              items: [
                {
                  href: payload?.urls?.[0],
                  title: "Deep Research",
                  text: "x".repeat(400),
                  markdown: "# Deep Research\n\n" + "x".repeat(400),
                },
              ],
            },
          };
        }
        if (type === "upsertConversation") return { ok: true, data: { id: 33 } };
        if (type === "syncConversationMessages") return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      },
    });

    await harness.runTick();
    expect(harness.sendCalls.some((c) => c.type === "upsertConversation")).toBe(false);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(harness.sendCalls.some((c) => c.type === "upsertConversation")).toBe(true);
    expect(harness.sendCalls.some((c) => c.type === "syncConversationMessages")).toBe(true);
    expect(harness.tipCalls.some((c) => String(c.text) === "Saved")).toBe(true);

    vi.useRealTimers();
  });

  it("disables auto-save for googleaistudio to avoid virtualized truncation", async () => {
    const snapshot = {
      conversation: { source: "googleaistudio", conversationKey: "auto-ai-studio-1" },
      messages: [{ messageKey: "m1", sequence: 1, role: "user", contentText: "hello" }]
    };

    const harness = createHarness({
      collectorId: "googleaistudio",
      captureImpl: () => snapshot,
      incrementalImpl: (snap) => ({ changed: true, snapshot: snap }),
      sendImpl: async (type: string) => {
        if (type === "upsertConversation") return { ok: true, data: { id: 22 } };
        if (type === "syncConversationMessages") return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      }
    });

    await harness.runTick();

    expect(harness.sendCalls.some((c) => c.type === "upsertConversation")).toBe(false);
    expect(harness.sendCalls.some((c) => c.type === "syncConversationMessages")).toBe(false);
    expect(harness.tipCalls.some((c) => String(c.text) === "Saved")).toBe(false);
  });

  it("ignores repeated manual clicks while a save is still in progress", async () => {
    let resolveUpsert: ((value: any) => void) | null = null;
    const upsertPending = new Promise((resolve) => {
      resolveUpsert = resolve;
    });

    const harness = createHarness({
      captureImpl: (args) => {
        if (!args || !args.manual) return null;
        return {
          conversation: { source: "gemini", conversationKey: "lock-1" },
          messages: [{ messageKey: "m1", sequence: 1, role: "user", contentText: "hi" }]
        };
      },
      sendImpl: async (type: string) => {
        if (type === "upsertConversation") {
          await upsertPending;
          return { ok: true, data: { id: 31 } };
        }
        if (type === "syncConversationMessages") return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      }
    });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onClick).toBe("function");

    const firstClick = cfg.onClick();
    const secondClick = cfg.onClick();
    await Promise.resolve();

    expect(harness.sendCalls.filter((c) => c.type === "upsertConversation")).toHaveLength(1);

    resolveUpsert && resolveUpsert({});
    await firstClick;
    await secondClick;

    expect(harness.sendCalls.filter((c) => c.type === "syncConversationMessages")).toHaveLength(1);
  });
});
