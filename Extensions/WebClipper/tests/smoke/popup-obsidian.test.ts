import { describe, expect, it } from "vitest";

function loadPopupObsidian() {
  // @ts-expect-error test global
  globalThis.WebClipper = {
    popupCore: {
      sanitizeFilenamePart: (input: string, fallback: string) => {
        const raw = String(input || "").replace(/[\\/:*?"<>|]/g, " ").trim();
        return raw || String(fallback || "fallback");
      }
    },
    conversationKinds: {
      pick: (conversation: any) => {
        const sourceType = conversation && conversation.sourceType ? String(conversation.sourceType) : "chat";
        if (sourceType === "article") return { id: "article", obsidian: { folder: "SyncNos-WebArticles" } };
        return { id: "chat", obsidian: { folder: "SyncNos-AIChats" } };
      }
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/ui/popup/popup-obsidian.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/ui/popup/popup-obsidian.js");
}

describe("popup-obsidian", () => {
  it("creates one payload per doc for multi selection", () => {
    const api = loadPopupObsidian();
    const payloads = api.createObsidianPayloads(
      [
        { conversation: { id: 1, title: "Chat A" }, markdown: "# A" },
        { conversation: { id: 2, title: "Chat B" }, markdown: "# B" }
      ],
      { stamp: "2026-02-23T00-00-00-000Z" }
    );

    expect(payloads).toEqual([
      { noteName: "Chat A", markdown: "# A", folder: "SyncNos-AIChats" },
      { noteName: "Chat B", markdown: "# B", folder: "SyncNos-AIChats" }
    ]);
  });

  it("deduplicates duplicate note names", () => {
    const api = loadPopupObsidian();
    const payloads = api.createObsidianPayloads(
      [
        { conversation: { id: 1, title: "Same Title" }, markdown: "# A" },
        { conversation: { id: 2, title: "Same Title" }, markdown: "# B" }
      ],
      { stamp: "2026-02-23T00-00-00-000Z" }
    );

    expect(payloads[0].noteName).toBe("Same Title");
    expect(payloads[1].noteName).toBe("Same Title-2");
    expect(payloads[0].folder).toBe("SyncNos-AIChats");
    expect(payloads[1].folder).toBe("SyncNos-AIChats");
  });

  it("builds obsidian://new urls for clipboard and content mode", () => {
    const api = loadPopupObsidian();
    const clipboardUrl = api.buildObsidianNewUrl({
      noteName: "Clip Name",
      markdown: "# hello world",
      useClipboard: true
    });
    const contentUrl = api.buildObsidianNewUrl({
      noteName: "Clip Name",
      markdown: "# hello world",
      useClipboard: false
    });

    expect(clipboardUrl).toContain("obsidian://new?");
    expect(clipboardUrl).toContain("clipboard=1");
    expect(clipboardUrl).toContain("file=SyncNos-AIChats%2FClip%20Name");
    expect(clipboardUrl).not.toContain("+");
    expect(contentUrl).toContain("content=");
    expect(contentUrl).toContain("file=SyncNos-AIChats%2FClip%20Name");
    expect(contentUrl).toContain("content=%23%20hello%20world");
    expect(contentUrl).not.toContain("+");
    expect(contentUrl).not.toContain("clipboard=1");
  });

  it("routes article payloads to SyncNos-WebArticles folder", () => {
    const api = loadPopupObsidian();
    const payloads = api.createObsidianPayloads(
      [{ conversation: { id: 1, title: "A1", sourceType: "article" }, markdown: "# A" }],
      { stamp: "2026-02-23T00-00-00-000Z" }
    );
    expect(payloads[0].folder).toBe("SyncNos-WebArticles");
    const url = api.buildObsidianNewUrl({ noteName: payloads[0].noteName, markdown: payloads[0].markdown, useClipboard: false, folder: payloads[0].folder });
    expect(url).toContain("file=SyncNos-WebArticles%2FA1");
  });

  it("throws when docs are empty", () => {
    const api = loadPopupObsidian();
    expect(() => api.createObsidianPayloads([])).toThrow("No conversations selected.");
  });
});
