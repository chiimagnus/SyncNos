import { describe, expect, it } from "vitest";

function load(rel: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const p = require.resolve(rel);
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[p];
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

describe("obsidian local rest api sync e2e flow (mock)", () => {
  it("full -> incremental -> delete -> rebuild, and handles auth failure", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    setupChromeStorage();

    const settingsStore = load("../../src/export/obsidian/obsidian-settings-store.js");
    load("../../src/export/obsidian/obsidian-local-rest-client.js");
    load("../../src/export/obsidian/obsidian-note-path.js");
    load("../../src/export/obsidian/obsidian-sync-metadata.js");
    load("../../src/export/obsidian/obsidian-markdown-writer.js");
    const orch = load("../../src/export/obsidian/obsidian-sync-orchestrator.js");

    // Local data
    let messages: any[] = [
      { messageKey: "m1", sequence: 1, role: "assistant", contentMarkdown: "a", updatedAt: 1 }
    ];
    // @ts-expect-error test global
    globalThis.WebClipper.backgroundStorage = {
      async getConversationById() {
        return { id: 1, sourceType: "chat", source: "chatgpt", conversationKey: "k1", title: "t" };
      },
      async getMessagesByConversationId() {
        return messages.slice();
      }
    };

    await settingsStore.saveSettings({ enabled: true, apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k" });

    // Remote state
    let remoteExists = false;
    let remoteFrontmatter: any = null;
    let appendDedupOnce = false;
    let authFail = false;

    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const method = String(init?.method || "GET").toUpperCase();

      if (authFail) {
        return new Response(JSON.stringify({ errorCode: 40100, message: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
      }

      if (method === "GET") {
        if (!remoteExists) {
          return new Response(JSON.stringify({ errorCode: 40400, message: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ frontmatter: remoteFrontmatter || {}, content: "x" }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "PUT") {
        remoteExists = true;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "PATCH") {
        const headers = init?.headers as Headers;
        const targetType = headers?.get("Target-Type") || "";
        const target = headers?.get("Target") || "";
        if (targetType === "heading" && target === "SyncNos::Messages") {
          if (appendDedupOnce) {
            appendDedupOnce = false;
            return new Response(JSON.stringify({ errorCode: 40080, message: "content-already-preexists-in-target" }), { status: 400, headers: { "content-type": "application/json" } });
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (targetType === "frontmatter" && target === "syncnos") {
          const body = String(init?.body || "");
          remoteFrontmatter = { syncnos: JSON.parse(body) };
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ errorCode: 40000, message: "unexpected patch target" }), { status: 400, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({ errorCode: 40000, message: "unexpected method" }), { status: 400, headers: { "content-type": "application/json" } });
    };

    // 1) First sync: remote missing -> full rebuild
    const r1 = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(r1.okCount).toBe(1);
    expect(r1.results[0].mode).toBe("full_rebuild");

    // Simulate what the written note now contains in frontmatter for next run.
    remoteFrontmatter = {
      syncnos: {
        source: "chatgpt",
        conversationKey: "k1",
        schemaVersion: 1,
        lastSyncedSequence: 1,
        lastSyncedMessageKey: "m1",
        lastSyncedMessageUpdatedAt: 1,
        lastSyncedAt: 1
      }
    };

    // 2) Add one new message locally -> incremental append
    messages = [
      ...messages,
      { messageKey: "m2", sequence: 2, role: "assistant", contentMarkdown: "b", updatedAt: 2 }
    ];
    const r2 = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(r2.okCount).toBe(1);
    expect(r2.results[0].mode).toBe("incremental_append");
    expect(r2.results[0].appended).toBe(1);
    expect(remoteFrontmatter?.syncnos?.lastSyncedSequence).toBe(2);

    // 3) Repeat incremental, but server says content already exists -> still ok (idempotent)
    appendDedupOnce = true;
    const r3 = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(r3.okCount).toBe(1);
    expect(r3.results[0].mode).toBe("no_changes");

    // 4) Remote deleted -> rebuild again
    remoteExists = false;
    const r4 = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(r4.okCount).toBe(1);
    expect(r4.results[0].mode).toBe("full_rebuild");

    // 5) Auth fails -> failure result
    authFail = true;
    const r5 = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(r5.failCount).toBe(1);
    expect(r5.results[0].mode).toBe("failed");
  });
});

