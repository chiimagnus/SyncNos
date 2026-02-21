import { describe, expect, it } from "vitest";

function loadCollectorUtils() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/collector-utils.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/collector-utils.js");
}

describe("collector-utils images", () => {
  it("extracts best http(s) image urls from element", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const dom = new JSDOM(
      `<body>
        <div id="root">
          <img src="data:image/png;base64,abc" />
          <img src="https://example.com/a.jpg" />
          <img src="https://example.com/a.jpg" />
          <img srcset="https://example.com/small.png 200w, https://example.com/large.png 1200w" />
          <img srcset="https://example.com/1x.webp 1x, https://example.com/2x.webp 2x" />
        </div>
      </body>`,
      { url: "https://example.com/" }
    );

    // @ts-expect-error test global
    globalThis.window = dom.window;
    // @ts-expect-error test global
    globalThis.document = dom.window.document;

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const utils = loadCollectorUtils();

    const root = dom.window.document.getElementById("root");
    const urls = utils.extractImageUrlsFromElement(root);
    expect(urls).toEqual([
      "https://example.com/a.jpg",
      "https://example.com/large.png",
      "https://example.com/2x.webp"
    ]);
  });

  it("appends image markdown without duplicating existing urls", () => {
    // @ts-expect-error test global
    globalThis.WebClipper = {};
    const utils = loadCollectorUtils();

    const base = "Hello\n\n![](https://example.com/a.png)";
    const md = utils.appendImageMarkdown(base, [
      "https://example.com/a.png",
      "https://example.com/b.png",
      "data:image/png;base64,abc"
    ]);
    expect(md).toBe("Hello\n\n![](https://example.com/a.png)\n\n![](https://example.com/b.png)");
  });
});

