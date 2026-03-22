import { afterEach, describe, expect, it, vi } from "vitest";

const backgroundStorageMocks = vi.hoisted(() => ({
  getConversationById: vi.fn(),
  getMessagesByConversationId: vi.fn(),
}));

vi.mock("@services/conversations/background/storage", () => ({
  backgroundStorage: {
    getConversationById: backgroundStorageMocks.getConversationById,
    getMessagesByConversationId: backgroundStorageMocks.getMessagesByConversationId,
  },
}));

async function load(rel: string) {
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

describe("obsidian local rest api sync e2e flow (mock)", () => {
  it("rebuilds notes on every sync, and handles auth failure", async () => {
    setupChromeStorage();

    const settingsStore = await load("../../src/sync/obsidian/settings-store.ts");
    await load("../../src/sync/obsidian/obsidian-local-rest-client.ts");
    await load("../../src/sync/obsidian/obsidian-note-path.ts");
    await load("../../src/sync/obsidian/obsidian-sync-metadata.ts");
    await load("../../src/sync/obsidian/obsidian-markdown-writer.ts");
    const orch = await load("../../src/sync/obsidian/obsidian-sync-orchestrator.ts");

    // Local data
    let messages: any[] = [
      { messageKey: "m1", sequence: 1, role: "assistant", contentMarkdown: "a", updatedAt: 1 }
    ];
    backgroundStorageMocks.getConversationById.mockResolvedValue({
      id: 1,
      sourceType: "chat",
      source: "chatgpt",
      conversationKey: "k1",
      title: "t",
    });
    backgroundStorageMocks.getMessagesByConversationId.mockImplementation(async () => messages.slice());

    await settingsStore.saveObsidianSettings({ enabled: true, apiBaseUrl: "http://127.0.0.1:27123", apiKey: "k" });

    // Remote state
    let remoteExists = false;
    let remoteFrontmatter: any = null;
    let remoteContent = "";
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
        return new Response(JSON.stringify({ frontmatter: remoteFrontmatter || {}, content: remoteContent || "" }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "PUT") {
        remoteExists = true;
        remoteContent = String(init?.body || "");
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({ errorCode: 40000, message: "unexpected method" }), { status: 400, headers: { "content-type": "application/json" } });
    };

    // 1) First sync: remote missing -> full rebuild
    const r1 = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(r1.okCount).toBe(1);
    expect(r1.results[0].mode).toBe("full_rebuild");

    // 2) Add one new message locally -> rebuild again
    messages = [
      ...messages,
      { messageKey: "m2", sequence: 2, role: "assistant", contentMarkdown: "b", updatedAt: 2 }
    ];
    const r2 = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(r2.okCount).toBe(1);
    expect(r2.results[0].mode).toBe("full_rebuild");
    expect(r2.results[0].appended).toBe(2);

    // 3) Remote deleted -> rebuild again
    remoteExists = false;
    const r3 = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(r3.okCount).toBe(1);
    expect(r3.results[0].mode).toBe("full_rebuild");

    // 4) Auth fails -> failure result
    authFail = true;
    const r4 = await orch.syncConversations({ conversationIds: [1], instanceId: "x" });
    expect(r4.failCount).toBe(1);
    expect(r4.results[0].mode).toBe("failed");
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
