import { describe, expect, it } from "vitest";

function loadMetadata() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/export/obsidian/obsidian-sync-metadata.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/export/obsidian/obsidian-sync-metadata.js");
}

describe("obsidian-sync-metadata", () => {
  it("reads missing or mismatched schema as non-ok", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const mod = loadMetadata();
    expect(mod.readSyncnosObject(null).ok).toBe(false);
    expect(mod.readSyncnosObject({ syncnos: { schemaVersion: 2 } }).ok).toBe(false);
  });

  it("builds and reads syncnos object", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const mod = loadMetadata();
    const syncnos = mod.buildSyncnosObject({
      conversation: { source: "x", conversationKey: "y" },
      cursor: { lastSyncedSequence: 12, lastSyncedMessageKey: "m1", lastSyncedMessageUpdatedAt: 9, lastSyncedAt: 10 }
    });

    const parsed = mod.readSyncnosObject({ syncnos });
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.source).toBe("x");
    expect(parsed.data?.conversationKey).toBe("y");
    expect(parsed.data?.lastSyncedSequence).toBe(12);
    expect(parsed.data?.lastSyncedMessageKey).toBe("m1");
    expect(parsed.data?.lastSyncedMessageUpdatedAt).toBe(9);
    expect(parsed.data?.lastSyncedAt).toBe(10);
  });
});
