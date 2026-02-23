import { describe, expect, it } from "vitest";

function loadNormalize() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/shared/normalize.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/shared/normalize.js");
}

function loadCollectorUtils() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/collector-utils.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/collector-utils.js");
}

function loadGeminiCollector() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/gemini-collector.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/gemini-collector.js");
}

function setupGeminiDom(html: string, url: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(`<body>${html}</body>`, { url });
  // @ts-expect-error test global
  globalThis.window = dom.window;
  // @ts-expect-error test global
  globalThis.document = dom.window.document;
  // @ts-expect-error test global
  globalThis.Node = dom.window.Node;
  // @ts-expect-error test global
  globalThis.location = dom.window.location;
  return dom;
}

describe("gemini-collector", () => {
  it("prefers conversation title from latest DOM marker", async () => {
    const html = `
      <div class="center-section">
        <div class="conversation-title-container">
          <span class="conversation-title-column">
            <span data-test-id="conversation-title" class="gds-title-m">DOM Title</span>
          </span>
        </div>
      </div>
      <div id="chat-history">
        <div class="conversation-container">
          <user-query><div class="query-text">hello</div></user-query>
          <model-response><div class="model-response-text">world</div></model-response>
        </div>
      </div>
    `;
    const dom = setupGeminiDom(html, "https://gemini.google.com/app/abc123");
    dom.window.document.title = "Page Title Should Not Win";

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    loadNormalize();
    loadCollectorUtils();
    loadGeminiCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.gemini.capture();
    expect(snap).toBeTruthy();
    expect(snap.conversation.title).toBe("DOM Title");
  });

  it("falls back to document.title when conversation title node is missing", async () => {
    const html = `
      <div id="chat-history">
        <div class="conversation-container">
          <user-query><div class="query-text">hello</div></user-query>
          <model-response><div class="model-response-text">world</div></model-response>
        </div>
      </div>
    `;
    const dom = setupGeminiDom(html, "https://gemini.google.com/app/xyz789");
    dom.window.document.title = "Gemini Page Title";

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    loadNormalize();
    loadCollectorUtils();
    loadGeminiCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.gemini.capture();
    expect(snap).toBeTruthy();
    expect(snap.conversation.title).toBe("Gemini Page Title");
  });
});
