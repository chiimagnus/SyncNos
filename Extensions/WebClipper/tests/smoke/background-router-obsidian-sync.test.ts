import { describe, expect, it } from "vitest";

function loadBackgroundRouter() {
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
      getSettings: 0,
      saveSettings: null,
      testConnection: 0,
      getSyncStatus: 0,
      syncConversations: null
    };

    // @ts-expect-error test global
    globalThis.WebClipper = {
      backgroundStorage: {},
      obsidianSettingsStore: {
        async getSettings() {
          calls.getSettings += 1;
          return { enabled: true, apiBaseUrl: "http://127.0.0.1:27123", authHeaderName: "Authorization" };
        },
        async saveSettings(payload: any) {
          calls.saveSettings = payload;
          return { saved: true, ...payload };
        }
      },
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

    const router = loadBackgroundRouter();

    const getRes = await router.__handleMessageForTests({ type: "obsidianGetSettings" });
    expect(getRes.ok).toBe(true);
    expect(getRes.data?.enabled).toBe(true);
    expect(calls.getSettings).toBe(1);

    const saveRes = await router.__handleMessageForTests({
      type: "obsidianSaveSettings",
      enabled: false,
      apiBaseUrl: "http://127.0.0.1:27123",
      apiKey: "k",
      authHeaderName: "Authorization"
    });
    expect(saveRes.ok).toBe(true);
    expect(calls.saveSettings?.enabled).toBe(false);
    expect(calls.saveSettings?.apiKey).toBe("k");

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

