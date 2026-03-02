import { describe, expect, it } from "vitest";

async function loadWriter() {
  // @ts-expect-error test global
  globalThis.WebClipper = {};
  const mod = await import("../../src/export/obsidian/obsidian-markdown-writer.ts");
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
    expect(md).toContain(`## ${w.MESSAGES_HEADING}`);
    expect(md).toContain("#### 1 assistant m1");
    expect(md).toContain("hi");
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
    await w.replaceSyncnosFrontmatter({ client, filePath: "A/B.md", syncnosObject: { a: 1 } });

    expect(calls.length).toBe(2);
    expect(calls[0].payload.operation).toBe("append");
    expect(calls[0].payload.targetType).toBe("heading");
    expect(calls[0].payload.target).toBe(w.MESSAGES_HEADING);
    expect(calls[1].payload.targetType).toBe("frontmatter");
    expect(calls[1].payload.target).toBe("syncnos");
    expect(calls[1].payload.contentType).toBe("application/json");
  });
});
