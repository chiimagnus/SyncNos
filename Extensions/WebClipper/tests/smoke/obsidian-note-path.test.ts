import { describe, expect, it } from "vitest";

function loadKinds() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const contractPath = require.resolve("../../src/protocols/conversation-kind-contract.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[contractPath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../src/protocols/conversation-kind-contract.js");

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const kindsPath = require.resolve("../../src/protocols/conversation-kinds.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[kindsPath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../src/protocols/conversation-kinds.js");
}

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
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    loadKinds();
    const mod = loadNotePath();

    const convo = { sourceType: "article", source: "goodlinks", conversationKey: "abc" };
    const path1 = mod.buildStableNotePath(convo);
    const path2 = mod.buildStableNotePath(convo);
    expect(path1).toBe(path2);
    expect(path1).toContain("SyncNos-WebArticles/");
    expect(path1).toMatch(/goodlinks-[0-9a-f]{16}\.md$/);
  });
});

