import { describe, expect, it } from "vitest";
import { conversationKinds } from "../../src/protocols/conversation-kinds.ts";

function loadConversationKinds() {
  return conversationKinds;
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

  it("article pageSpec.shouldRebuild triggers when the synced article body updatedAt moves forward", () => {
    const kinds = loadConversationKinds();
    const kind = kinds.pick({ sourceType: "article" });
    const should = kind.notion.pageSpec.shouldRebuild({
      conversation: { sourceType: "article" },
      mapping: { lastSyncedMessageKey: "article_body", lastSyncedMessageUpdatedAt: 1000 },
      messages: [{ messageKey: "article_body", updatedAt: 1001 }]
    });
    expect(should).toBe(true);
  });

  it("article pageSpec.shouldRebuild stays false when cursor points at an older body and newer messages can append", () => {
    const kinds = loadConversationKinds();
    const kind = kinds.pick({ sourceType: "article" });
    const should = kind.notion.pageSpec.shouldRebuild({
      conversation: { sourceType: "article" },
      mapping: { lastSyncedMessageKey: "article_body", lastSyncedMessageUpdatedAt: 1000 },
      messages: [
        { messageKey: "article_body", updatedAt: 1000, sequence: 1 },
        { messageKey: "article_extra", updatedAt: 2000, sequence: 2 },
      ]
    });
    expect(should).toBe(false);
  });

  it("exposes notion storage keys from registry (used by infra like disconnect/backup)", () => {
    const kinds = loadConversationKinds();
    const keys = kinds.getNotionStorageKeys();
    expect(keys).toContain("notion_db_id_syncnos_ai_chats");
    expect(keys).toContain("notion_db_id_syncnos_web_articles");
  });
});
