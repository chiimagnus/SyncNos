import { describe, expect, it } from "vitest";

function loadBackgroundRouter() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const storeModulePath = require.resolve("../../src/export/obsidian/obsidian-settings-store.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[storeModulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../src/export/obsidian/obsidian-settings-store.js");

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/bootstrap/background-router.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/bootstrap/background-router.js");
}

describe("background-router obsidian sync routes", () => {
  it("delegates settings get/save and orchestrator actions", async () => {
    const calls: any = {
      testConnection: 0,
      getSyncStatus: 0,
      syncConversations: null
    };

    const store: Record<string, unknown> = {};
    // @ts-expect-error test global
    globalThis.WebClipper = {
      backgroundStorage: {},
      obsidianSyncOrchestrator: {
        async testConnection({ instanceId }: any) {
          calls.testConnection += 1;
          return { ok: true, instanceId };
        },
        async getSyncStatus({ instanceId }: any) {
          calls.getSyncStatus += 1;
          return { job: null, instanceId };
        },
        async syncConversations(payload: any) {
          calls.syncConversations = payload;
          return { okCount: 1, failCount: 0, results: [{ conversationId: 1, ok: true }], payload };
        }
      }
    };

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

    const router = loadBackgroundRouter();

    const getRes = await router.__handleMessageForTests({ type: "obsidianGetSettings" });
    expect(getRes.ok).toBe(true);
    expect(getRes.data?.enabled).toBe(false);
    expect(getRes.data?.apiBaseUrl).toContain("http://127.0.0.1:27123");
    expect(getRes.data?.apiKeyPresent).toBe(false);

    const saveRes = await router.__handleMessageForTests({
      type: "obsidianSaveSettings",
      enabled: false,
      apiBaseUrl: "http://127.0.0.1:27123",
      apiKey: "k",
      authHeaderName: "Authorization"
    });
    expect(saveRes.ok).toBe(true);
    expect(saveRes.data?.enabled).toBe(false);
    expect(saveRes.data?.apiKeyPresent).toBe(true);
    expect(saveRes.data?.apiKeyMasked).toBe("********");

    const testRes = await router.__handleMessageForTests({ type: "obsidianTestConnection" });
    expect(testRes.ok).toBe(true);
    expect(calls.testConnection).toBe(1);
    expect(typeof testRes.data?.instanceId).toBe("string");

    const statusRes = await router.__handleMessageForTests({ type: "obsidianGetSyncStatus" });
    expect(statusRes.ok).toBe(true);
    expect(calls.getSyncStatus).toBe(1);
    expect(typeof statusRes.data?.instanceId).toBe("string");

    const syncRes = await router.__handleMessageForTests({
      type: "obsidianSyncConversations",
      conversationIds: [1, 2],
      forceFullConversationIds: [2]
    });
    expect(syncRes.ok).toBe(true);
    expect(Array.isArray(calls.syncConversations?.conversationIds)).toBe(true);
    expect(calls.syncConversations?.conversationIds).toEqual([1, 2]);
    expect(calls.syncConversations?.forceFullConversationIds).toEqual([2]);
    expect(typeof calls.syncConversations?.instanceId).toBe("string");
  });
});
