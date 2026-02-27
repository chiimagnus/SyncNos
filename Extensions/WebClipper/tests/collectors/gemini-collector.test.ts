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

function loadGeminiMarkdown() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/gemini/gemini-markdown.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/gemini/gemini-markdown.js");
}

function loadGeminiCollector() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/gemini/gemini-collector.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/gemini/gemini-collector.js");
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
    loadGeminiMarkdown();
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
    loadGeminiMarkdown();
    loadGeminiCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.gemini.capture();
    expect(snap).toBeTruthy();
    expect(snap.conversation.title).toBe("Gemini Page Title");
  });

  it("extracts assistant contentMarkdown from semantic markdown DOM", async () => {
    const html = `
      <div id="chat-history">
        <div class="conversation-container">
          <user-query><div class="query-text">hello</div></user-query>
          <model-response>
            <div class="markdown markdown-main-panel preserve-whitespaces-in-response" inline-copy-host id="model-response-message-contentr_xxx" aria-busy="false">
              <h2>Section</h2>
              <p><strong>Bold</strong> and <a href="https://example.com">link</a>.</p>
              <ul><li><p>Item A</p></li><li><p>Item B</p></li></ul>
              <blockquote><p>Quoted text</p></blockquote>
              <table>
                <thead><tr><td>A</td><td>B</td></tr></thead>
                <tbody><tr><td>1</td><td>2</td></tr></tbody>
              </table>
              <code-block>
                <div class="code-block-decoration"><span>Swift</span><div class="buttons"><button>复制代码</button></div></div>
                <pre><code data-test-id="code-content">print("hi")</code></pre>
              </code-block>
            </div>
          </model-response>
        </div>
      </div>
    `;
    setupGeminiDom(html, "https://gemini.google.com/app/md001");

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    loadNormalize();
    loadCollectorUtils();
    loadGeminiMarkdown();
    loadGeminiCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.gemini.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).toContain("## Section");
    expect(assistant.contentMarkdown).toContain("**Bold**");
    expect(assistant.contentMarkdown).toContain("[link](https://example.com)");
    expect(assistant.contentMarkdown).toContain("- Item A");
    expect(assistant.contentMarkdown).toContain("> Quoted text");
    expect(assistant.contentMarkdown).toContain("| A | B |");
    expect(assistant.contentMarkdown).toContain("```swift");
    expect(assistant.contentMarkdown).toContain("print(\"hi\")");
    expect(assistant.contentMarkdown).not.toContain("复制代码");
  });

  it("falls back to plain text markdown when markdown helper is unavailable", async () => {
    const html = `
      <div id="chat-history">
        <div class="conversation-container">
          <user-query><div class="query-text">hello</div></user-query>
          <model-response><div class="model-response-text">plain answer</div></model-response>
        </div>
      </div>
    `;
    setupGeminiDom(html, "https://gemini.google.com/app/fallback1");

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    loadNormalize();
    loadCollectorUtils();
    loadGeminiCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.gemini.capture();
    expect(snap).toBeTruthy();
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentText).toBe("plain answer");
    expect(assistant.contentMarkdown).toBe("plain answer");
  });
});
