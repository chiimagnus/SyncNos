import { afterEach, describe, expect, it } from "vitest";

function loadArticleMarkdown() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/export/article-markdown.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/export/article-markdown.js");
}

afterEach(() => {
  // @ts-expect-error test cleanup
  delete globalThis.WebClipper;
});

describe("article-markdown", () => {
  it("prefers contentMarkdown over plain text for article body", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const api = loadArticleMarkdown();

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
