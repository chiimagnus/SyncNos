import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import normalizeApi from "../../src/shared/normalize.ts";
import { createCollectorEnv } from "../../src/collectors/collector-env.ts";
import { createGeminiCollectorDef } from "../../src/collectors/gemini/gemini-collector.ts";

function setupGeminiDom(html: string, url: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
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

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = createGeminiCollectorDef(env).collector.capture() as any;
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

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = createGeminiCollectorDef(env).collector.capture() as any;
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
              <div class="math-block" data-math="S = \\sum_{i=1}^{n} x_i">
                <span class="katex-display"><span class="katex"><span class="katex-html" aria-hidden="true">ignored</span></span></span>
              </div>
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
    const dom = setupGeminiDom(html, "https://gemini.google.com/app/md001");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = createGeminiCollectorDef(env).collector.capture() as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).toContain("## Section");
    expect(assistant.contentMarkdown).toContain("**Bold**");
    expect(assistant.contentMarkdown).toContain("[link](https://example.com)");
    expect(assistant.contentMarkdown).toContain("$$S = \\sum_{i=1}^{n} x_i$$");
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
    vi.resetModules();
    vi.doMock("../../src/collectors/gemini/gemini-markdown.ts", () => ({ default: {} }));

    const dom = setupGeminiDom(html, "https://gemini.google.com/app/fallback1");
    const { createGeminiCollectorDef: createDef } = await import("../../src/collectors/gemini/gemini-collector.ts");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = createDef(env).collector.capture() as any;
    expect(snap).toBeTruthy();
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentText).toBe("plain answer");
    expect(assistant.contentMarkdown).toBe("plain answer");
  });
});
