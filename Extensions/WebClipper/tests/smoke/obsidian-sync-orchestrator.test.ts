import { afterEach, describe, expect, it, vi } from "vitest";

const backgroundStorageMocks = vi.hoisted(() => ({
  getConversationById: vi.fn(),
  getMessagesByConversationId: vi.fn(),
}));

vi.mock("../../src/conversations/background-storage", () => ({
  backgroundStorage: {
    getConversationById: backgroundStorageMocks.getConversationById,
    getMessagesByConversationId: backgroundStorageMocks.getMessagesByConversationId,
  },
}));

async function loadModule(rel: string) {
  const mod = await import(/* @vite-ignore */ rel);
  return (mod as any).default || mod;
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
  it("reports missing_api_key when api key is not configured", async () => {
    setupChromeStorage();
    await loadModule("../../src/sync/obsidian/obsidian-settings-store.ts");
    await loadModule("../../src/sync/obsidian/obsidian-local-rest-client.ts");
    const orch = await loadModule("../../src/sync/obsidian/obsidian-sync-orchestrator.ts");

    const res = await orch.testConnection({ instanceId: "x" });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("missing_api_key");
  });

  it("decides full rebuild when remote note is missing (404)", async () => {
    setupChromeStorage();
    const store = await loadModule("../../src/sync/obsidian/obsidian-settings-store.ts");
    await loadModule("../../src/sync/obsidian/obsidian-local-rest-client.ts");
    await loadModule("../../src/sync/obsidian/obsidian-note-path.ts");
    await loadModule("../../src/sync/obsidian/obsidian-sync-metadata.ts");
    await loadModule("../../src/sync/obsidian/obsidian-markdown-writer.ts");
    const orch = await loadModule("../../src/sync/obsidian/obsidian-sync-orchestrator.ts");

    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: "chat",
      source: "chatgpt",
      conversationKey: "k1",
      title: "t",
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: "m1", sequence: 1, contentMarkdown: "hi", updatedAt: Date.now() },
    ]);

    let call = 0;
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      call += 1;
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "GET") {
        return new Response(JSON.stringify({ errorCode: 40400, message: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
      }
      if (method === "PUT") {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ errorCode: 40000, message: "unexpected" }), { status: 400, headers: { "content-type": "application/json" } });
    };

    await store.saveSettings({ apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k" });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(syncRes.results[0].mode).toBe("full_rebuild");
    expect(syncRes.results[0].ok).toBe(true);
  });

  it("decides incremental append when remote has cursor and there are new messages", async () => {
    setupChromeStorage();
    const store = await loadModule("../../src/sync/obsidian/obsidian-settings-store.ts");
    await loadModule("../../src/sync/obsidian/obsidian-local-rest-client.ts");
    await loadModule("../../src/sync/obsidian/obsidian-note-path.ts");
    await loadModule("../../src/sync/obsidian/obsidian-sync-metadata.ts");
    await loadModule("../../src/sync/obsidian/obsidian-markdown-writer.ts");
    const orch = await loadModule("../../src/sync/obsidian/obsidian-sync-orchestrator.ts");

    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: "chat",
      source: "chatgpt",
      conversationKey: "k1",
      title: "t",
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: "m1", sequence: 1, contentMarkdown: "a", updatedAt: 1 },
      { messageKey: "m2", sequence: 2, contentMarkdown: "b", updatedAt: 2 },
    ]);

    const calls: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      calls.push({ url: _url, init });
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "GET") {
        return new Response(JSON.stringify({
          frontmatter: {
            syncnos: { source: "chatgpt", conversationKey: "k1", schemaVersion: 1, lastSyncedSequence: 1, lastSyncedMessageKey: "m1" }
          },
          content: "x"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (method === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ errorCode: 40000, message: "unexpected" }), { status: 400, headers: { "content-type": "application/json" } });
    };

    await store.saveSettings({ apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k" });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(syncRes.results[0].mode).toBe("incremental_append");
    expect(syncRes.results[0].appended).toBe(1);
    expect(syncRes.results[0].ok).toBe(true);

    const status = await orch.getSyncStatus({ instanceId: "x" });
    expect(status.job?.status).toBe("finished");
  });

  it("falls back to full rebuild when cursor updatedAt mismatches local history", async () => {
    setupChromeStorage();
    const store = await loadModule("../../src/sync/obsidian/obsidian-settings-store.ts");
    await loadModule("../../src/sync/obsidian/obsidian-local-rest-client.ts");
    await loadModule("../../src/sync/obsidian/obsidian-note-path.ts");
    await loadModule("../../src/sync/obsidian/obsidian-sync-metadata.ts");
    await loadModule("../../src/sync/obsidian/obsidian-markdown-writer.ts");
    const orch = await loadModule("../../src/sync/obsidian/obsidian-sync-orchestrator.ts");

    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: "chat",
      source: "chatgpt",
      conversationKey: "k1",
      title: "t",
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: "m1", sequence: 1, contentMarkdown: "a", updatedAt: 1 },
      { messageKey: "m2", sequence: 2, contentMarkdown: "b", updatedAt: 2 },
    ]);

    // GET returns cursor with mismatched updatedAt -> should rebuild (PUT)
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "GET") {
        return new Response(JSON.stringify({
          frontmatter: {
            syncnos: { source: "chatgpt", conversationKey: "k1", schemaVersion: 1, lastSyncedSequence: 1, lastSyncedMessageKey: "m1", lastSyncedMessageUpdatedAt: 999 }
          },
          content: "x"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (method === "PUT") {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ errorCode: 40000, message: "unexpected" }), { status: 400, headers: { "content-type": "application/json" } });
    };

    await store.saveSettings({ apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k" });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(syncRes.results[0].ok).toBe(true);
    expect(syncRes.results[0].mode).toBe("full_rebuild");
  });

  it("falls back to full rebuild when PATCH fails with PatchFailed (non-dedup)", async () => {
    setupChromeStorage();
    const store = await loadModule("../../src/sync/obsidian/obsidian-settings-store.ts");
    await loadModule("../../src/sync/obsidian/obsidian-local-rest-client.ts");
    await loadModule("../../src/sync/obsidian/obsidian-note-path.ts");
    await loadModule("../../src/sync/obsidian/obsidian-sync-metadata.ts");
    await loadModule("../../src/sync/obsidian/obsidian-markdown-writer.ts");
    const orch = await loadModule("../../src/sync/obsidian/obsidian-sync-orchestrator.ts");

    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: "chat",
      source: "chatgpt",
      conversationKey: "k1",
      title: "t",
    });
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: "m1", sequence: 1, contentMarkdown: "a", updatedAt: 1 },
      { messageKey: "m2", sequence: 2, contentMarkdown: "b", updatedAt: 2 },
    ]);

    let patchCount = 0;
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "GET") {
        return new Response(JSON.stringify({
          frontmatter: {
            syncnos: { source: "chatgpt", conversationKey: "k1", schemaVersion: 1, lastSyncedSequence: 1, lastSyncedMessageKey: "m1", lastSyncedMessageUpdatedAt: 1 }
          },
          content: "x"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (method === "PATCH") {
        patchCount += 1;
        return new Response(JSON.stringify({ errorCode: 40080, message: "PatchFailed: something else" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      if (method === "PUT") {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ errorCode: 40000, message: "unexpected" }), { status: 400, headers: { "content-type": "application/json" } });
    };

    await store.saveSettings({ apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k" });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(patchCount).toBe(1);
    expect(syncRes.results[0].ok).toBe(true);
    expect(syncRes.results[0].mode).toBe("full_rebuild_fallback");
  });

  it("renames note when title changes by rebuilding new file and deleting old file", async () => {
    setupChromeStorage();
    const store = await loadModule("../../src/sync/obsidian/obsidian-settings-store.ts");
    await loadModule("../../src/sync/obsidian/obsidian-local-rest-client.ts");
    await loadModule("../../src/sync/obsidian/obsidian-note-path.ts");
    await loadModule("../../src/sync/obsidian/obsidian-sync-metadata.ts");
    await loadModule("../../src/sync/obsidian/obsidian-markdown-writer.ts");
    const naming = await loadModule("../../src/conversations/file-naming.ts");
    const orch = await loadModule("../../src/sync/obsidian/obsidian-sync-orchestrator.ts");

    const convo = { id: 1, sourceType: "chat", source: "chatgpt", conversationKey: "k1", title: "New Title" };
    const stableId10 = naming.stableConversationId10(convo);
    const oldFilename = `chatgpt-Old Title-${stableId10}.md`;
    const oldFilenameEncoded = oldFilename.replace(/ /g, "%20");

    backgroundStorageMocks.getConversationById.mockResolvedValue(convo);
    backgroundStorageMocks.getMessagesByConversationId.mockResolvedValue([
      { messageKey: "m1", sequence: 1, contentMarkdown: "hi", updatedAt: 1 },
    ]);

    const seen: any[] = [];
    // @ts-expect-error test global
    globalThis.fetch = async (_url: any, init: any) => {
      const url = String(_url || "");
      const method = String(init?.method || "GET").toUpperCase();
      seen.push({ method, url });

      if (method === "GET" && url.endsWith("/vault/SyncNos-AIChats/")) {
        return new Response(JSON.stringify({ files: [oldFilename] }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "GET" && url.includes(`/vault/SyncNos-AIChats/${oldFilenameEncoded}`)) {
        return new Response(JSON.stringify({
          frontmatter: {
            syncnos: {
              source: "chatgpt",
              conversationKey: "k1",
              schemaVersion: 1,
              lastSyncedSequence: 1,
              lastSyncedMessageKey: "m1",
              lastSyncedMessageUpdatedAt: 1
            }
          },
          content: "x"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "GET") {
        return new Response(JSON.stringify({ errorCode: 40400, message: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
      }

      if (method === "PUT") {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response(JSON.stringify({ errorCode: 40000, message: "unexpected" }), { status: 400, headers: { "content-type": "application/json" } });
    };

    await store.saveSettings({ apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k" });
    const syncRes = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(syncRes.results[0].ok).toBe(true);
    expect(syncRes.results[0].mode).toBe("full_rebuild_rename");

    const didPut = seen.some((c) => c.method === "PUT");
    const didDelete = seen.some((c) => c.method === "DELETE");
    expect(didPut).toBe(true);
    expect(didDelete).toBe(true);
  });
});

afterEach(() => {
  backgroundStorageMocks.getConversationById.mockReset();
  backgroundStorageMocks.getMessagesByConversationId.mockReset();
  // @ts-expect-error test cleanup
  delete globalThis.fetch;
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});
