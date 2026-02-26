import { describe, expect, it } from "vitest";

function loadConversationKinds() {
  // @ts-expect-error test global
  globalThis.WebClipper = {};
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
  return require("../../src/protocols/conversation-kinds.js");
}

describe("conversation-kinds", () => {
  it("registers built-in kinds and picks article by sourceType", () => {
    const kinds = loadConversationKinds();
    const list = kinds.list();
    expect(list.length).toBeGreaterThanOrEqual(2);

    const article = kinds.pick({ sourceType: "article", title: "T" });
    expect(article.id).toBe("article");
    expect(article.obsidian.folder).toBe("SyncNos-WebArticles");
    expect(article.notion.dbSpec.storageKey).toBe("notion_db_id_syncnos_web_articles");
  });

  it("defaults to chat when no kind matches", () => {
    const kinds = loadConversationKinds();
    const chat = kinds.pick({ sourceType: "unknown", title: "T", source: "chatgpt" });
    expect(chat.id).toBe("chat");
    expect(chat.obsidian.folder).toBe("SyncNos-AIChats");
    expect(chat.notion.dbSpec.storageKey).toBe("notion_db_id_syncnos_ai_chats");
  });

  it("article pageSpec.shouldRebuild triggers when a message updatedAt is newer than mapping.lastSyncedAt", () => {
    const kinds = loadConversationKinds();
    const kind = kinds.pick({ sourceType: "article" });
    const should = kind.notion.pageSpec.shouldRebuild({
      conversation: { sourceType: "article" },
      mapping: { lastSyncedAt: 1000 },
      messages: [{ updatedAt: 999 }, { updatedAt: 1001 }]
    });
    expect(should).toBe(true);
  });

  it("exposes notion storage keys from registry (used by infra like disconnect/backup)", () => {
    const kinds = loadConversationKinds();
    const keys = kinds.getNotionStorageKeys();
    expect(keys).toContain("notion_db_id_syncnos_ai_chats");
    expect(keys).toContain("notion_db_id_syncnos_web_articles");
  });
});
