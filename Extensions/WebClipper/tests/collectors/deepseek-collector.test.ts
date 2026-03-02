import { describe, expect, it } from "vitest";

async function loadNormalize() {
  const normalizeModule = await import("../../src/shared/normalize.ts");
  const normalizeApi = normalizeModule.default || {
    normalizeText: normalizeModule.normalizeText,
    fnv1a32: normalizeModule.fnv1a32,
    makeFallbackMessageKey: normalizeModule.makeFallbackMessageKey,
  };
  const collectorContextModule = await import("../../src/collectors/collector-context.ts");
  const collectorContext = collectorContextModule.default as any;
  collectorContext.normalize = normalizeApi;
  if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
    globalThis.WebClipper = {};
  }
  globalThis.WebClipper.normalize = normalizeApi;
  return normalizeApi;
}

function loadCollectorUtils() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/collector-utils.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/collector-utils.js");
}

async function loadDeepseekMarkdown() {
  return import("../../src/collectors/deepseek/deepseek-markdown.ts");
}

async function loadDeepseekCollector() {
  return import("../../src/collectors/deepseek/deepseek-collector.ts");
}

function setupDeepseekDom(html: string, url: string) {
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

describe("deepseek-collector", () => {
  it("extracts assistant contentMarkdown from semantic markdown DOM", async () => {
    const html = `
      <main class="dad65929">
        <div class="_9663006">
          <div class="fbb737a4">你好</div>
        </div>
        <div class="_4f9bf79 _43c05b5">
          <div class="ds-message">
            <div class="ds-markdown">
              <h1><span>主标题</span></h1>
              <blockquote>
                <p class="ds-markdown-paragraph"><span>引用内容</span></p>
                <blockquote><p class="ds-markdown-paragraph"><span>嵌套引用</span></p></blockquote>
              </blockquote>
              <ul>
                <li>
                  <p class="ds-markdown-paragraph"><span>父级条目</span></p>
                  <ul><li><p class="ds-markdown-paragraph"><span>子级条目</span></p></li></ul>
                </li>
              </ul>
              <ol start="2"><li><p class="ds-markdown-paragraph"><span>第二项</span></p></li></ol>
              <p class="ds-markdown-paragraph"><strong><span>粗体</span></strong> <em><span>斜体</span></em> <code>sum(1,2)</code> <a href="https://example.com">链接</a></p>
              <table>
                <thead><tr><th><span>语法元素</span></th><th><span>说明</span></th></tr></thead>
                <tbody><tr><td><span>标题</span></td><td><span>使用 #</span></td></tr></tbody>
              </table>
              <div class="md-code-block md-code-block-dark">
                <div class="md-code-block-banner-wrap">
                  <span class="d813de27">python</span>
                  <button role="button">复制</button>
                  <button role="button">下载</button>
                </div>
                <pre><span>def greet(name):</span><br><span>    return f"Hello, {name}"</span></pre>
              </div>
            </div>
          </div>
        </div>
      </main>
    `;

    setupDeepseekDom(html, "https://chat.deepseek.com/a/chat/s/abc123");

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    loadCollectorUtils();
    await loadDeepseekMarkdown();
    await loadDeepseekCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.deepseek.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).toContain("# 主标题");
    expect(assistant.contentMarkdown).toContain("> 引用内容");
    expect(assistant.contentMarkdown).toContain("> > 嵌套引用");
    expect(assistant.contentMarkdown).toContain("- 父级条目");
    expect(assistant.contentMarkdown).toContain("  - 子级条目");
    expect(assistant.contentMarkdown).toContain("2. 第二项");
    expect(assistant.contentMarkdown).toContain("**粗体**");
    expect(assistant.contentMarkdown).toContain("*斜体*");
    expect(assistant.contentMarkdown).toContain("`sum(1,2)`");
    expect(assistant.contentMarkdown).toContain("[链接](https://example.com)");
    expect(assistant.contentMarkdown).toContain("| 语法元素 | 说明 |");
    expect(assistant.contentMarkdown).toContain("```python");
    expect(assistant.contentMarkdown).toContain("def greet(name):");
    expect(assistant.contentMarkdown).not.toContain("复制");
    expect(assistant.contentMarkdown).not.toContain("下载");

    expect(assistant.contentText).toContain("主标题");
    expect(assistant.contentText).toContain("def greet(name):");
    expect(assistant.contentText).not.toContain("复制");
  });

  it("falls back to plain text markdown when markdown helper is unavailable", async () => {
    const html = `
      <main class="dad65929">
        <div class="_4f9bf79 _43c05b5">
          <div class="ds-message">
            <div class="ds-markdown"><p class="ds-markdown-paragraph">plain answer</p></div>
          </div>
        </div>
      </main>
    `;

    setupDeepseekDom(html, "https://chat.deepseek.com/a/chat/s/fallback1");

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    loadCollectorUtils();
    await loadDeepseekCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.deepseek.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("assistant");
    expect(snap.messages[0].contentText).toBe("plain answer");
    expect(snap.messages[0].contentMarkdown).toBe("plain answer");
  });
});
