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
  it("filters out visually hidden speaker labels (cross-language)", async () => {
    const html = `
      <div id="chat-history">
        <div class="conversation-container">
          <user-query>
            <div class="query-text">
              <span class="cdk-visually-hidden">你说</span>
              <p class="query-text-line">你好</p>
            </div>
          </user-query>
          <model-response>
            <div class="model-response-text">
              <span class="cdk-visually-hidden">Gemini说</span>
              <p>世界</p>
            </div>
          </model-response>
        </div>
      </div>
    `;
    const dom = setupGeminiDom(html, "https://gemini.google.com/app/hidden001");

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = await Promise.resolve(createGeminiCollectorDef(env).collector.capture()) as any;
    expect(snap).toBeTruthy();

    const user = snap.messages.find((m: { role: string }) => m.role === "user");
    expect(user).toBeTruthy();
    expect(user.contentText).toContain("你好");
    expect(user.contentText).not.toContain("你说");

    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentText).toContain("世界");
    expect(assistant.contentText).not.toContain("Gemini说");
  });

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

    const snap = await Promise.resolve(createGeminiCollectorDef(env).collector.capture()) as any;
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

    const snap = await Promise.resolve(createGeminiCollectorDef(env).collector.capture()) as any;
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

    const snap = await Promise.resolve(createGeminiCollectorDef(env).collector.capture()) as any;
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

    const snap = await Promise.resolve(createDef(env).collector.capture()) as any;
    expect(snap).toBeTruthy();
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentText).toBe("plain answer");
    expect(assistant.contentMarkdown).toBe("plain answer");
  });

  it("inlines blob: uploaded images as data:image urls", async () => {
    const blobUrl = "blob:https://gemini.google.com/42056040-2bdc-4af6-b583-dd8f79be7801";
    const data = new Uint8Array([0, 1, 2, 3, 4, 5]);

    const html = `
      <div id="chat-history">
        <div class="conversation-container">
          <user-query>
            <div class="query-text">看这张图</div>
            <img data-test-id="uploaded-img" alt="所上传图片的预览图" class="preview-image" src="${blobUrl}">
          </user-query>
          <model-response><div class="model-response-text">好的</div></model-response>
        </div>
      </div>
    `;
    const dom = setupGeminiDom(html, "https://gemini.google.com/app/blob001");

    (dom.window as any).fetch = vi.fn(async (url: string) => {
      if (url !== blobUrl) return { ok: false, blob: async () => new dom.window.Blob() };
      return {
        ok: true,
        blob: async () => new dom.window.Blob([data], { type: "image/png" }),
      };
    });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = await Promise.resolve(createGeminiCollectorDef(env).collector.capture()) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    const user = snap.messages.find((m: { role: string }) => m.role === "user");
    expect(user).toBeTruthy();
    expect(user.contentMarkdown).toContain("![](data:image/png");
  });
});
