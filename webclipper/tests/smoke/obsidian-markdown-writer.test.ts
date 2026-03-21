import { describe, expect, it } from "vitest";

async function loadWriter() {
  const mod = await import("../../src/sync/obsidian/obsidian-markdown-writer.ts");
  return mod.default || mod;
}

describe("obsidian-markdown-writer", () => {
  it("builds full markdown with frontmatter and stable heading", async () => {
    const w = await loadWriter();
    const md = w.buildFullNoteMarkdown({
      conversation: { title: "T", source: "s", sourceType: "chat", conversationKey: "k" },
      messages: [{ messageKey: "m1", sequence: 1, role: "assistant", contentMarkdown: "hi" }],
      syncnosObject: { source: "s", conversationKey: "k", schemaVersion: 1, lastSyncedSequence: 1, lastSyncedMessageKey: "m1" }
    });
    expect(md).toContain("---");
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

  it("issues patch calls for append and frontmatter replace", async () => {
    const w = await loadWriter();
    const calls: any[] = [];
    const client = {
      patchVaultFile: async (filePath: string, payload: any) => {
        calls.push({ filePath, payload });
        return { ok: true, status: 200, data: {} };
      }
    };

    await w.appendUnderMessagesHeading({ client, filePath: "A/B.md", markdown: "x" });
    await w.replaceUnderArticleHeading({ client, filePath: "A/B.md", markdown: "a" });
    await w.replaceUnderCommentsHeading({ client, filePath: "A/B.md", markdown: "b" });
    await w.replaceSyncnosFrontmatter({ client, filePath: "A/B.md", syncnosObject: { a: 1 } });

    expect(calls.length).toBe(4);
    expect(calls[0].payload.operation).toBe("append");
    expect(calls[0].payload.targetType).toBe("heading");
    expect(calls[0].payload.target).toBe(w.MESSAGES_HEADING);
    expect(calls[1].payload.operation).toBe("replace");
    expect(calls[1].payload.targetType).toBe("heading");
    expect(calls[1].payload.target).toBe(w.ARTICLE_HEADING);
    expect(calls[2].payload.operation).toBe("replace");
    expect(calls[2].payload.targetType).toBe("heading");
    expect(calls[2].payload.target).toBe(w.COMMENTS_HEADING);
    expect(calls[3].payload.targetType).toBe("frontmatter");
    expect(calls[3].payload.target).toBe("syncnos");
    expect(calls[3].payload.contentType).toBe("application/json");
  });

  it("dedupes and replaces level-2 heading sections in existing markdown", async () => {
    const w = await loadWriter();
    const src = [
      "---",
      "title: \"T\"",
      "---",
      "",
      "# T",
      "",
      "## Article",
      "",
      "Old article",
      "",
      "## Comments",
      "",
      "> Quoted",
      "",
      "- Old",
      "",
      "## Comments",
      "",
      "- Newer duplicate",
      "",
      "## Tail",
      "",
      "Keep me",
      "",
    ].join("\n");
    const res = w.replaceLevel2HeadingSectionInMarkdown({
      sourceMarkdown: src,
      heading: w.COMMENTS_HEADING,
      bodyMarkdown: "- Replaced",
      dedupe: true,
    });
    expect(res.ok).toBe(true);
    const out = String(res.markdown || "");
    expect(out.match(/^##\s+Comments\s*$/gm)?.length || 0).toBe(1);
    expect(out).toContain("- Replaced");
    expect(out).not.toContain("- Old");
    expect(out).not.toContain("- Newer duplicate");
    expect(out).toContain("## Tail");
    expect(out).toContain("Keep me");
  });
});
