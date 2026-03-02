import { describe, expect, it } from "vitest";

function loadNotePath() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/export/obsidian/obsidian-note-path.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/export/obsidian/obsidian-note-path.js");
}

describe("obsidian-note-path", () => {
  it("builds stable path from source+conversationKey and routes to kind folder", () => {
    const mod = loadNotePath();

    const convo = { sourceType: "article", source: "goodlinks", conversationKey: "abc" };
    const path1 = mod.buildStableNotePath(convo);
    const path2 = mod.buildStableNotePath(convo);
    expect(path1).toBe(path2);
    expect(path1).toContain("SyncNos-WebArticles/");
    expect(path1).toMatch(/goodlinks-[0-9a-f]{16}\.md$/);
  });

  it("allows per-kind folder override (e.g. user-configured paths)", () => {
    const mod = loadNotePath();

    const convo = { sourceType: "article", source: "goodlinks", conversationKey: "abc" };
    const p = mod.buildStableNotePath(convo, { folderByKindId: { article: "My/Custom Folder" } });
    expect(p).toContain("My/Custom Folder/");
    expect(p).toMatch(/goodlinks-[0-9a-f]{16}\.md$/);
  });
});
