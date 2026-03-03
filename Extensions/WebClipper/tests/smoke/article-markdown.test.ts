import { afterEach, describe, expect, it } from "vitest";

async function loadArticleMarkdown() {
  const mod = await import("../../src/sync/local/article-markdown.ts");
  return mod.default || mod;
}

afterEach(() => {
  // @ts-expect-error test cleanup
  delete globalThis.WebClipper;
});

describe("article-markdown", () => {
  it("prefers contentMarkdown over plain text for article body", async () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const api = await loadArticleMarkdown();

    const markdown = api.formatArticleMarkdown({
      conversation: { title: "Article" },
      messages: [{
        contentMarkdown: "## Section\n\n![Image](https://example.com/image.png)",
        contentText: "plain text body"
      }]
    });

    expect(markdown).toContain("## Section");
    expect(markdown).toContain("![Image](https://example.com/image.png)");
    expect(markdown).not.toContain("plain text body");
  });
});
