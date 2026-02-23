import { describe, expect, it } from "vitest";

function loadPopupNotionSyncState() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/ui/popup/popup-notion-sync-state.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/ui/popup/popup-notion-sync-state.js");
}

describe("popup-notion-sync-state", () => {
  it("normalizes raw sync record", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const api = loadPopupNotionSyncState();
    const record = api.normalizeSyncRecord({ conversationId: "10", ok: true, appended: "3" }, 1000);
    expect(record.conversationId).toBe(10);
    expect(record.ok).toBe(true);
    expect(record.mode).toBe("ok");
    expect(record.appended).toBe(3);
    expect(record.at).toBe(1000);
  });

  it("applies rows to notionSyncById map and triggers callback", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const api = loadPopupNotionSyncState();
    const state: any = { notionSyncById: new Map() };
    let changed = 0;

    const res = api.applySyncResults({
      rows: [
        { conversationId: 1, ok: true, mode: "appended", appended: 2 },
        { conversationId: 2, ok: false, error: "failed" }
      ],
      state,
      onChanged: () => {
        changed += 1;
      }
    });

    expect(res.applied).toBe(2);
    expect(changed).toBe(1);
    expect(state.notionSyncById.get(1)?.mode).toBe("appended");
    expect(state.notionSyncById.get(2)?.error).toBe("failed");
  });

  it("ignores invalid conversation ids", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const api = loadPopupNotionSyncState();
    const state: any = { notionSyncById: new Map() };

    const res = api.applySyncResults({
      rows: [{ conversationId: "bad", ok: true }],
      state
    });

    expect(res.applied).toBe(0);
    expect(state.notionSyncById.size).toBe(0);
  });
});
