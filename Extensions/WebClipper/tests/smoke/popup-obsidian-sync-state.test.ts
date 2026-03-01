import { describe, expect, it } from "vitest";

function loadPopupObsidianSyncState() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/ui/popup/popup-obsidian-sync-state.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/ui/popup/popup-obsidian-sync-state.js");
}

describe("popup-obsidian-sync-state", () => {
  it("normalizes raw sync record", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const api = loadPopupObsidianSyncState();
    const record = api.normalizeSyncRecord({ conversationId: "10", ok: true, appended: "3" }, 1000);
    expect(record.conversationId).toBe(10);
    expect(record.ok).toBe(true);
    expect(record.mode).toBe("ok");
    expect(record.appended).toBe(3);
    expect(record.at).toBe(1000);
  });

  it("applies rows to obsidianSyncById map", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const api = loadPopupObsidianSyncState();
    const state: any = { obsidianSyncById: new Map() };
    const res = api.applySyncResults({
      rows: [
        { conversationId: 1, ok: true, mode: "incremental_append", appended: 2 },
        { conversationId: 2, ok: false, error: "failed" }
      ],
      state
    });
    expect(res.applied).toBe(2);
    expect(state.obsidianSyncById.get(1)?.mode).toBe("incremental_append");
    expect(state.obsidianSyncById.get(2)?.error).toBe("failed");
  });
});

