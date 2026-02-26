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

function createHarness(options?: { sendImpl?: (type: string, payload?: any) => Promise<any> }) {
  let tickRef: TickFn = null;
  let buttonConfig: any = null;
  const tipCalls: any[] = [];
  const sendCalls: Array<{ type: string; payload?: any }> = [];

  // @ts-expect-error test global (needed by getInpageCollector)
  globalThis.location = { href: "https://example.com/post", hostname: "example.com", pathname: "/post" };

  // @ts-expect-error test global
  globalThis.WebClipper = {
    messageContracts: {
      CORE_MESSAGE_TYPES: {
        UPSERT_CONVERSATION: "upsertConversation",
        SYNC_CONVERSATION_MESSAGES: "syncConversationMessages"
      },
      ARTICLE_MESSAGE_TYPES: {
        FETCH_ACTIVE_TAB: "fetchActiveTabArticle"
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
  // @ts-expect-error cleanup
  delete globalThis.location;
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
