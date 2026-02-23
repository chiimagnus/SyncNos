import { describe, expect, it } from "vitest";

type ChromeMockOptions = {
  updateError?: string;
  createError?: string;
  disableUpdate?: boolean;
  disableCreate?: boolean;
  onUpdate?: (payload: any) => void;
  onCreate?: (payload: any) => void;
};

function createChromeMock(options: ChromeMockOptions = {}) {
  const store: Record<string, unknown> = {};
  const runtime: { lastError: null | { message?: string } } = { lastError: null };
  const tabs: Record<string, any> = {};

  if (!options.disableUpdate) {
    tabs.update = (payload: any, cb: () => void) => {
      options.onUpdate && options.onUpdate(payload);
      runtime.lastError = options.updateError ? { message: options.updateError } : null;
      cb && cb();
      runtime.lastError = null;
    };
  }

  if (!options.disableCreate) {
    tabs.create = (payload: any, cb: () => void) => {
      options.onCreate && options.onCreate(payload);
      runtime.lastError = options.createError ? { message: options.createError } : null;
      cb && cb();
      runtime.lastError = null;
    };
  }

  return {
    runtime,
    storage: {
      local: {
        get(keys: string[], cb: (res: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of keys) out[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb();
        }
      }
    },
    tabs
  };
}

function loadBackgroundRouter() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const serviceModulePath = require.resolve("../../src/sync/obsidian/obsidian-url-service.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[serviceModulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../src/sync/obsidian/obsidian-url-service.js");

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/bootstrap/background-router.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/bootstrap/background-router.js");
}

describe("background-router obsidian open url", () => {
  it("opens obsidian url via tabs.update", async () => {
    const updateCalls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = {
      backgroundStorage: {}
    };
    // @ts-expect-error test global
    globalThis.chrome = createChromeMock({
      onUpdate: (payload) => updateCalls.push(payload)
    });

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({
      type: "openObsidianUrl",
      url: "obsidian://new?name=SyncNos"
    });

    expect(res.ok).toBe(true);
    expect(updateCalls.length).toBe(1);
    expect(String(updateCalls[0]?.url || "")).toContain("obsidian://new");
  });

  it("falls back to tabs.create when tabs.update fails", async () => {
    const createCalls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = {
      backgroundStorage: {}
    };
    // @ts-expect-error test global
    globalThis.chrome = createChromeMock({
      updateError: "update failed",
      onCreate: (payload) => createCalls.push(payload)
    });

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({
      type: "openObsidianUrl",
      url: "obsidian://new?name=SyncNos"
    });

    expect(res.ok).toBe(true);
    expect(createCalls.length).toBe(1);
    expect(String(createCalls[0]?.url || "")).toContain("obsidian://new");
  });

  it("opens multiple obsidian urls in order when urls[] is provided", async () => {
    const updateCalls: any[] = [];
    // @ts-expect-error test global
    globalThis.WebClipper = {
      backgroundStorage: {}
    };
    // @ts-expect-error test global
    globalThis.chrome = createChromeMock({
      onUpdate: (payload) => updateCalls.push(payload)
    });

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({
      type: "openObsidianUrl",
      urls: [
        "obsidian://new?name=SyncNos-1",
        "obsidian://new?name=SyncNos-2"
      ]
    });

    expect(res.ok).toBe(true);
    expect(res.data?.count).toBe(2);
    expect(updateCalls.length).toBe(2);
    expect(String(updateCalls[0]?.url || "")).toContain("SyncNos-1");
    expect(String(updateCalls[1]?.url || "")).toContain("SyncNos-2");
  });

  it("rejects non-obsidian url", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {
      backgroundStorage: {}
    };
    // @ts-expect-error test global
    globalThis.chrome = createChromeMock();

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({
      type: "openObsidianUrl",
      url: "https://example.com"
    });

    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("invalid obsidian url");
  });

  it("rejects invalid url inside urls[] payload", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {
      backgroundStorage: {}
    };
    // @ts-expect-error test global
    globalThis.chrome = createChromeMock();

    const router = loadBackgroundRouter();
    const res = await router.__handleMessageForTests({
      type: "openObsidianUrl",
      urls: ["obsidian://new?name=ok", "https://example.com"]
    });

    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("invalid obsidian url");
  });
});
