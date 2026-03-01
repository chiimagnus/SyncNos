import { describe, expect, it } from "vitest";

function loadModule(rel: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve(rel);
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(rel);
}

function setupChromeStorage() {
  const store: Record<string, unknown> = {};
  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys: any, cb: (res: Record<string, unknown>) => void) {
          const list = Array.isArray(keys) ? keys : (typeof keys === "string" ? [keys] : Object.keys(keys || {}));
          const out: Record<string, unknown> = {};
          for (const k of list) out[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
          cb(out);
        },
        set(payload: Record<string, unknown>, cb: () => void) {
          for (const [k, v] of Object.entries(payload || {})) store[k] = v;
          cb && cb();
        }
      }
    }
  };
  return store;
}

describe("obsidian-sync-orchestrator", () => {
  it("reports disabled when setting is off", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    setupChromeStorage();
    loadModule("../../src/export/obsidian/obsidian-settings-store.js");
    loadModule("../../src/export/obsidian/obsidian-local-rest-client.js");
    const orch = loadModule("../../src/export/obsidian/obsidian-sync-orchestrator.js");

    const res = await orch.testConnection({ instanceId: "x" });
    expect(res.ok).toBe(false);
    expect(res.enabled).toBe(false);
    expect(res.error?.code).toBe("disabled");
  });

  it("runs sync job and exposes job status", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    setupChromeStorage();
    const store = loadModule("../../src/export/obsidian/obsidian-settings-store.js");
    loadModule("../../src/export/obsidian/obsidian-local-rest-client.js");
    const orch = loadModule("../../src/export/obsidian/obsidian-sync-orchestrator.js");

    await store.saveSettings({ enabled: true });

    const syncRes = await orch.syncConversations({ conversationIds: [1, 2], instanceId: "x" });
    expect(syncRes.results.length).toBe(2);

    const status = await orch.getSyncStatus({ instanceId: "x" });
    expect(status.job?.status).toBe("finished");
    expect(Array.isArray(status.job?.perConversation)).toBe(true);
  });
});

