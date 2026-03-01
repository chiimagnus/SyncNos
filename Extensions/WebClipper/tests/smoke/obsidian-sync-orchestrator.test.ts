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

  it("decides full rebuild when remote note is missing (404)", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    setupChromeStorage();
    const store = loadModule("../../src/export/obsidian/obsidian-settings-store.js");
    loadModule("../../src/export/obsidian/obsidian-local-rest-client.js");
    loadModule("../../src/export/obsidian/obsidian-note-path.js");
    loadModule("../../src/export/obsidian/obsidian-sync-metadata.js");
    const orch = loadModule("../../src/export/obsidian/obsidian-sync-orchestrator.js");

    // @ts-expect-error test global
    globalThis.WebClipper.backgroundStorage = {
      async getConversationById() {
        return { id: 1, sourceType: "chat", source: "chatgpt", conversationKey: "k1", title: "t" };
      },
      async getMessagesByConversationId() {
        return [{ messageKey: "m1", sequence: 1, contentMarkdown: "hi", updatedAt: Date.now() }];
      }
    };

    // @ts-expect-error test global
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ errorCode: 40400, message: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
    };

    await store.saveSettings({ enabled: true, apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k" });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(syncRes.results[0].mode).toBe("full_rebuild");
  });

  it("decides incremental append when remote has cursor and there are new messages", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    setupChromeStorage();
    const store = loadModule("../../src/export/obsidian/obsidian-settings-store.js");
    loadModule("../../src/export/obsidian/obsidian-local-rest-client.js");
    loadModule("../../src/export/obsidian/obsidian-note-path.js");
    loadModule("../../src/export/obsidian/obsidian-sync-metadata.js");
    const orch = loadModule("../../src/export/obsidian/obsidian-sync-orchestrator.js");

    // @ts-expect-error test global
    globalThis.WebClipper.backgroundStorage = {
      async getConversationById() {
        return { id: 1, sourceType: "chat", source: "chatgpt", conversationKey: "k1", title: "t" };
      },
      async getMessagesByConversationId() {
        return [
          { messageKey: "m1", sequence: 1, contentMarkdown: "a", updatedAt: 1 },
          { messageKey: "m2", sequence: 2, contentMarkdown: "b", updatedAt: 2 }
        ];
      }
    };

    // @ts-expect-error test global
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        frontmatter: {
          syncnos: { source: "chatgpt", conversationKey: "k1", schemaVersion: 1, lastSyncedSequence: 1, lastSyncedMessageKey: "m1" }
        },
        content: "x"
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    await store.saveSettings({ enabled: true, apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k" });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(syncRes.results[0].mode).toBe("incremental_append");
    expect(syncRes.results[0].appended).toBe(1);

    const status = await orch.getSyncStatus({ instanceId: "x" });
    expect(status.job?.status).toBe("finished");
  });
});
