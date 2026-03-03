import { describe, expect, it } from "vitest";

async function loadFresh(rel: string) {
  const mod = await import(/* @vite-ignore */ `${rel}?t=${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return (mod as any).default || mod;
}

async function loadNotionAi() {
  return loadFresh("../../src/sync/notion/notion-ai.ts");
}

async function loadNotionSyncService() {
  return loadFresh("../../src/sync/notion/notion-sync-service.ts");
}

describe("notion-sync-service markdown", () => {
  it("parses inline markdown into rich_text", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    await loadNotionAi();
    const notionSyncService = await loadNotionSyncService();

    const rich = notionSyncService.inlineMarkdownToRichText("Hello **bold** and `code` plus [link](https://example.com).");
    expect(Array.isArray(rich)).toBe(true);
    const bold = rich.find((x: any) => x && x.type === "text" && x.annotations && x.annotations.bold);
    expect(bold?.text?.content).toBe("bold");
    const code = rich.find((x: any) => x && x.type === "text" && x.annotations && x.annotations.code);
    expect(code?.text?.content).toBe("code");
    const link = rich.find((x: any) => x && x.type === "text" && x.text && x.text.link);
    expect(link?.text?.link?.url).toBe("https://example.com");
  });

  it("converts markdown to notion blocks (basic types)", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    await loadNotionAi();
    const notionSyncService = await loadNotionSyncService();

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

  it("converts image markdown to notion image blocks", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    await loadNotionAi();
    const notionSyncService = await loadNotionSyncService();

    const md = [
      "Hello",
      "",
      "![](https://example.com/a.png)",
      "",
      "World"
    ].join("\n");
    const blocks = notionSyncService.markdownToNotionBlocks(md);
    const img = blocks.find((b: any) => b && b.type === "image");
    expect(img?.image?.type).toBe("external");
    expect(img?.image?.external?.url).toBe("https://example.com/a.png");
  });

  it("messagesToBlocks uses markdown when present (notionai)", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    await loadNotionAi();
    const notionSyncService = await loadNotionSyncService();

    const messages = [
      { role: "assistant", contentText: "plain", contentMarkdown: "- item **b**" }
    ];
    const blocks = notionSyncService.messagesToBlocks(messages, { source: "notionai" });
    expect(blocks.some((b: any) => b && b.type === "bulleted_list_item")).toBe(true);
  });

  it("messagesToBlocks uses markdown when present (zai)", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};

    await loadNotionAi();
    const notionSyncService = await loadNotionSyncService();

    const messages = [
      { role: "assistant", contentText: "plain", contentMarkdown: "```js\nconsole.log(1)\n```" }
    ];
    const blocks = notionSyncService.messagesToBlocks(messages, { source: "zai" });
    expect(blocks.some((b: any) => b && b.type === "code")).toBe(true);
  });
});
