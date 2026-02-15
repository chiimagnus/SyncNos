import { describe, expect, it } from "vitest";

function loadNotionAi() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/sync/notion/notion-ai.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/sync/notion/notion-ai.js");
}

describe("notion-sync-service markdown", () => {
  it("parses inline markdown into rich_text", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    loadNotionAi();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulePath = require.resolve("../../src/sync/notion/notion-sync-service.js");
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete require.cache[modulePath];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notionSyncService = require("../../src/sync/notion/notion-sync-service.js");

    const rich = notionSyncService.inlineMarkdownToRichText("Hello **bold** and `code` plus [link](https://example.com).");
    expect(Array.isArray(rich)).toBe(true);
    const bold = rich.find((x: any) => x && x.type === "text" && x.annotations && x.annotations.bold);
    expect(bold?.text?.content).toBe("bold");
    const code = rich.find((x: any) => x && x.type === "text" && x.annotations && x.annotations.code);
    expect(code?.text?.content).toBe("code");
    const link = rich.find((x: any) => x && x.type === "text" && x.text && x.text.link);
    expect(link?.text?.link?.url).toBe("https://example.com");
  });

  it("converts markdown to notion blocks (basic types)", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    loadNotionAi();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulePath = require.resolve("../../src/sync/notion/notion-sync-service.js");
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete require.cache[modulePath];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notionSyncService = require("../../src/sync/notion/notion-sync-service.js");

    const md = [
      "### Title",
      "",
      "- item **b**",
      "1. num *i*",
      "",
      "> quoted line",
      "",
      "---",
      "",
      "```js",
      "const x = 1",
      "```",
      "",
      "$$",
      "x^2",
      "$$"
    ].join("\n");

    const blocks = notionSyncService.markdownToNotionBlocks(md);
    expect(blocks.some((b: any) => b && b.type === "heading_3")).toBe(true);
    expect(blocks.some((b: any) => b && b.type === "bulleted_list_item")).toBe(true);
    expect(blocks.some((b: any) => b && b.type === "numbered_list_item")).toBe(true);
    expect(blocks.some((b: any) => b && b.type === "quote")).toBe(true);
    expect(blocks.some((b: any) => b && b.type === "divider")).toBe(true);
    expect(blocks.some((b: any) => b && b.type === "code")).toBe(true);
    expect(blocks.some((b: any) => b && b.type === "equation")).toBe(true);

    const bullet = blocks.find((b: any) => b && b.type === "bulleted_list_item");
    const rt = bullet?.bulleted_list_item?.rich_text || [];
    const bold = rt.find((x: any) => x && x.type === "text" && x.annotations && x.annotations.bold);
    expect(bold?.text?.content).toBe("b");
  });

  it("messagesToBlocks uses markdown for notionai source", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    loadNotionAi();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulePath = require.resolve("../../src/sync/notion/notion-sync-service.js");
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete require.cache[modulePath];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notionSyncService = require("../../src/sync/notion/notion-sync-service.js");

    const messages = [
      { role: "assistant", contentText: "plain", contentMarkdown: "- item **b**" }
    ];
    const blocks = notionSyncService.messagesToBlocks(messages, { source: "notionai" });
    expect(blocks.some((b: any) => b && b.type === "bulleted_list_item")).toBe(true);
  });
});
