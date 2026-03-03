import { describe, expect, it } from "vitest";

async function loadNotePath() {
  const mod = await import("../../src/sync/obsidian/obsidian-note-path.ts");
  return mod.default || mod;
}

describe("obsidian-note-path", () => {
  it("builds stable path from source+conversationKey and routes to kind folder", async () => {
    const mod = await loadNotePath();

    const convo = { sourceType: "article", source: "goodlinks", conversationKey: "abc" };
    const path1 = mod.buildStableNotePath(convo);
    const path2 = mod.buildStableNotePath(convo);
    expect(path1).toBe(path2);
    expect(path1).toContain("SyncNos-WebArticles/");
    expect(path1).toMatch(/goodlinks-Untitled-[0-9a-f]{10}\.md$/);
  });

  it("allows per-kind folder override (e.g. user-configured paths)", async () => {
    const mod = await loadNotePath();

    const convo = { sourceType: "article", source: "goodlinks", conversationKey: "abc" };
    const p = mod.buildStableNotePath(convo, { folderByKindId: { article: "My/Custom Folder" } });
    expect(p).toContain("My/Custom Folder/");
    expect(p).toMatch(/goodlinks-Untitled-[0-9a-f]{10}\.md$/);
  });
});
