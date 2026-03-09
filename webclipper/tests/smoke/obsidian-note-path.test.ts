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

  it("resolves an existing legacy file path before the stable path", async () => {
    const mod = await loadNotePath();

    const convo = { sourceType: "chat", source: "chatgpt", conversationKey: "abc", title: "Title" };
    const legacyPath = mod.buildLegacyHashNotePath(convo);
    const resolved = await mod.resolveExistingNotePath({
      conversation: convo,
      noteJsonAccept: "application/vnd.olrapi.note+json",
      readSyncnosObject: () => ({ ok: false }),
      client: {
        async getVaultFile(path: string) {
          if (path === mod.buildStableNotePath(convo)) {
            return { ok: false, status: 404, error: { code: "not_found", message: "missing" } };
          }
          if (path === legacyPath) {
            return { ok: true, data: { frontmatter: {} } };
          }
          return { ok: false, status: 404, error: { code: "not_found", message: "missing" } };
        },
        async listVaultDir() {
          return { ok: true, data: { files: [] } };
        },
      },
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.found).toBe(true);
    expect(resolved.resolvedFilePath).toBe(legacyPath);
    expect(resolved.matchedBy).toBe("legacy");
  });
});
