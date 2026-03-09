import { describe, expect, it } from "vitest";
import { registerObsidianSettingsHandlers } from "../../src/sync/obsidian/settings-background-handlers";
import { registerSyncHandlers } from "../../src/sync/background-handlers";
import { createBackgroundRouter } from "../../src/platform/messaging/background-router";

describe("background-router obsidian sync routes", () => {
  it("delegates settings get/save and orchestrator actions", async () => {
    const calls: any = {
      testConnection: 0,
      getSyncStatus: 0,
      syncConversations: null,
      syncMode: 'success',
    };

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

    const instanceId = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const router = createBackgroundRouter({
      fallback: (msg: any) => ({
        ok: false,
        data: null,
        error: { message: `unknown message type: ${msg?.type}`, extra: null },
      }),
    });

    registerObsidianSettingsHandlers(router as any, {
      getInstanceId: () => instanceId,
      testObsidianConnection: async ({ instanceId }: any) => {
        calls.testConnection += 1;
        return { ok: true, instanceId };
      },
    });
    registerSyncHandlers(router as any, {
      getInstanceId: () => instanceId,
      notionSyncOrchestrator: {
        syncConversations: async () => ({ okCount: 0, failCount: 0, results: [] }),
        getSyncJobStatus: async () => ({ job: null }),
        clearSyncJobStatus: async () => ({ job: null }),
      },
      obsidianSyncOrchestrator: {
        async getSyncStatus({ instanceId }: any) {
          calls.getSyncStatus += 1;
          return { job: null, instanceId };
        },
        async clearSyncStatus({ instanceId }: any) {
          return { job: null, instanceId };
        },
        async syncConversations(payload: any) {
          if (calls.syncMode === 'already-running') {
            const error = new Error('sync already in progress') as Error & { code?: string };
            error.code = 'sync_already_running';
            throw error;
          }
          calls.syncConversations = payload;
          return { okCount: 1, failCount: 0, results: [{ conversationId: 1, ok: true }], payload };
        },
      },
    });

    const getRes = await router.__handleMessageForTests({ type: "obsidianGetSettings" });
    expect(getRes.ok).toBe(true);
    expect(getRes.data?.apiBaseUrl).toContain("http://127.0.0.1:27123");
    expect(getRes.data?.apiKeyPresent).toBe(false);

    const saveRes = await router.__handleMessageForTests({
      type: "obsidianSaveSettings",
      apiBaseUrl: "http://127.0.0.1:27123",
      apiKey: "k",
      authHeaderName: "Authorization"
    });
    expect(saveRes.ok).toBe(true);
    expect(saveRes.data?.apiKeyPresent).toBe(true);
    expect(saveRes.data?.apiKeyMasked).toBe("********************************");

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

    calls.syncMode = 'already-running';
    const conflictRes = await router.__handleMessageForTests({
      type: "obsidianSyncConversations",
      conversationIds: [1],
    });
    expect(conflictRes.ok).toBe(false);
    expect(conflictRes.error?.message).toBe('sync already in progress');
    expect(conflictRes.error?.extra?.code).toBe('sync_already_running');
  });
});
