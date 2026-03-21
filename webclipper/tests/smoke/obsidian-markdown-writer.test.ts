import { describe, expect, it } from "vitest";

async function loadWriter() {
  const mod = await import("../../src/sync/obsidian/obsidian-markdown-writer.ts");
  return mod.default || mod;
}

describe("obsidian-markdown-writer", () => {
  it("builds full markdown with frontmatter and stable heading", async () => {
    const w = await loadWriter();
    const md = w.buildFullNoteMarkdown({
      conversation: { title: "T", source: "s", sourceType: "chat", conversationKey: "k", url: "https://example.com/chat" },
      messages: [{ messageKey: "m1", sequence: 1, role: "assistant", contentMarkdown: "hi" }],
      syncnosObject: { source: "s", conversationKey: "k", schemaVersion: 1, lastSyncedSequence: 1, lastSyncedMessageKey: "m1" }
    });
    expect(md).toContain("---");
    expect(md).toContain("url:");
    expect(md).toContain("syncnos:");
    expect(md).toContain(`# ${w.MESSAGES_HEADING}`);
    expect(md).toContain("## 1 assistant");
    expect(md).toContain("hi");
  });

  it("builds article markdown with Article/Comments sections and quote+bullets", async () => {
    const w = await loadWriter();
    const md = w.buildFullNoteMarkdown({
      conversation: { title: "T", source: "s", sourceType: "article", conversationKey: "k", url: "https://example.com" },
      messages: [{ messageKey: "article_body", sequence: 1, role: "assistant", contentMarkdown: "Body **md**" }],
      comments: [
        { id: 1, parentId: null, conversationId: 1, canonicalUrl: "https://example.com", quoteText: "Quoted", commentText: "Root", createdAt: 1, updatedAt: 1 },
        { id: 2, parentId: 1, conversationId: 1, canonicalUrl: "https://example.com", quoteText: "", commentText: "Reply", createdAt: 2, updatedAt: 2 },
      ],
      syncnosObject: { source: "s", conversationKey: "k", schemaVersion: 1, lastSyncedSequence: 1, lastSyncedMessageKey: "article_body" }
    });
    expect(md).toContain(`## ${w.ARTICLE_HEADING}`);
    expect(md).toContain(`## ${w.COMMENTS_HEADING}`);
    expect(md).not.toContain(`## ${w.MESSAGES_HEADING}`);
    expect(md).toContain("> Quoted");
    expect(md).toContain("- Root");
    expect(md).toContain("  - Reply");
  });
});
