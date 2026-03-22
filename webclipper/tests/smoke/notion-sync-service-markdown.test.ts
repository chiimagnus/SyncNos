import { describe, expect, it } from "vitest";

async function loadFresh(rel: string) {
  const mod = await import(/* @vite-ignore */ `${rel}?t=${Date.now()}_${Math.random().toString(16).slice(2)}`);
  return (mod as any).default || mod;
}

async function loadNotionAi() {
  return loadFresh("@services/sync/notion/notion-ai.ts");
}

async function loadNotionSyncService() {
  return loadFresh("@services/sync/notion/notion-sync-service.ts");
}

describe("notion-sync-service markdown", () => {
  it("parses inline markdown into rich_text", async () => {
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

  it("downgrades oversized inline equations into chunkable literal code text", async () => {
    await loadNotionAi();
    const notionSyncService = await loadNotionSyncService();

    const longExpression = "x".repeat(2118);
    const blocks = notionSyncService.markdownToNotionBlocks(`Before $${longExpression}$ after`);
    const paragraphs = blocks.filter((b: any) => b && b.type === "paragraph");
    expect(paragraphs.length).toBeGreaterThan(0);

    const richText = paragraphs.flatMap((block: any) => block?.paragraph?.rich_text || []);
    expect(richText.some((item: any) => item?.type === "equation")).toBe(false);
    const fallbackLiteral = richText
      .filter((item: any) => item?.type === "text" && item?.annotations?.code)
      .map((item: any) => item?.text?.content || "")
      .join("");
    expect(fallbackLiteral).toContain(`$${longExpression}$`);
  });

  it("downgrades oversized block equations into plain-text code blocks", async () => {
    await loadNotionAi();
    const notionSyncService = await loadNotionSyncService();

    const longExpression = "y".repeat(2118);
    const blocks = notionSyncService.markdownToNotionBlocks(["$$", longExpression, "$$"].join("\n"));
    expect(blocks.some((b: any) => b && b.type === "equation")).toBe(false);
    const codeBlocks = blocks.filter((b: any) => b && b.type === "code");
    expect(codeBlocks.length).toBeGreaterThan(0);
    const literal = codeBlocks
      .flatMap((block: any) => block?.code?.rich_text || [])
      .map((item: any) => item?.text?.content || "")
      .join("");
    expect(literal).toContain("$$");
    expect(literal).toContain(longExpression);
  });

  it("converts image markdown to notion image blocks", async () => {
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

  it("converts data:image markdown to notion image blocks (upgradeable)", async () => {
    await loadNotionAi();
    const notionSyncService = await loadNotionSyncService();

    const md = [
      "Hello",
      "",
      "![](data:image/png;base64,iVBORw0KGgo=)",
      "",
      "World"
    ].join("\n");
    const blocks = notionSyncService.markdownToNotionBlocks(md);
    const img = blocks.find((b: any) => b && b.type === "image");
    expect(img?.image?.type).toBe("external");
    expect(String(img?.image?.external?.url || "")).toContain("data:image/png;base64,");
  });

  it("messagesToBlocks uses markdown when present (notionai)", async () => {
    await loadNotionAi();
    const notionSyncService = await loadNotionSyncService();

    const messages = [
      { role: "assistant", contentText: "plain", contentMarkdown: "- item **b**" }
    ];
    const blocks = notionSyncService.messagesToBlocks(messages, { source: "notionai" });
    expect(blocks.some((b: any) => b && b.type === "bulleted_list_item")).toBe(true);
  });

  it("messagesToBlocks uses markdown when present (zai)", async () => {
    await loadNotionAi();
    const notionSyncService = await loadNotionSyncService();

    const messages = [
      { role: "assistant", contentText: "plain", contentMarkdown: "```js\nconsole.log(1)\n```" }
    ];
    const blocks = notionSyncService.messagesToBlocks(messages, { source: "zai" });
    expect(blocks.some((b: any) => b && b.type === "code")).toBe(true);
  });

  it("splits oversized rich_text arrays into multiple notion blocks", async () => {
    await loadNotionAi();
    const notionSyncService = await loadNotionSyncService();

    const markdown = Array.from({ length: 140 }, (_, index) => `**bold-${index}**`).join(" ");
    const blocks = notionSyncService.markdownToNotionBlocks(markdown);
    const paragraphs = blocks.filter((block: any) => block && block.type === "paragraph");

    expect(paragraphs.length).toBeGreaterThan(1);
    expect(
      paragraphs.every((block: any) => (block?.paragraph?.rich_text || []).length <= 100),
    ).toBe(true);
  });
});
