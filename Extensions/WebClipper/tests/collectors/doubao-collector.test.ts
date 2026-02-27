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

function loadDoubaoMarkdown() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/doubao/doubao-markdown.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/doubao/doubao-markdown.js");
}

function loadDoubaoCollector() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/doubao/doubao-collector.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/doubao/doubao-collector.js");
}

function setupDoubaoDom(html: string, url: string) {
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

describe("doubao-collector", () => {
  it("extracts assistant contentMarkdown from semantic markdown DOM", async () => {
    const html = `
      <main data-testid="message_list">
        <div data-testid="union_message">
          <div data-testid="send_message">
            <div data-testid="message_text_content">你好</div>
          </div>
          <div data-testid="receive_message">
            <div data-testid="think_block_collapse">
              <div data-testid="message_text_content">这是思考内容，不应被抓取</div>
            </div>
            <div data-testid="message_text_content" class="flow-markdown-body">
              <h1>生活随笔</h1>
              <div class="paragraph-pP9ZLC paragraph-element">清晨的阳光<strong>温柔</strong>，还有<em>热牛奶</em>。</div>
              <ul>
                <li>父级条目
                  <ul><li>子级条目</li></ul>
                </li>
              </ul>
              <blockquote><div class="paragraph-pP9ZLC paragraph-element">心若向阳，目之所及皆是美好。</div></blockquote>
              <div class="table-wrapper-wG0rS7">
                <div class="table-header-qH9Ajf"><div class="title-JhOBP1">表格</div><div class="actions-XLKatx">操作</div></div>
                <table>
                  <thead><tr><th>物品</th><th>用途</th></tr></thead>
                  <tbody><tr><td>笔记本</td><td>记录灵感</td></tr></tbody>
                </table>
              </div>
              <div class="paragraph-pP9ZLC paragraph-element">查看<a href="https://example.com/life">生活分享平台</a></div>
              <div class="code-block-element-R6c8c0 custom-code-block-container">
                <div class="header-wrapper-Mbk8s6">
                  <div class="title-TXcgFG"><div class="text-OkYU_0">python</div></div>
                  <div class="action-ysQCxz"><div class="hoverable-kRHiX2">运行</div><div class="hoverable-kRHiX2">复制</div></div>
                </div>
                <div class="content-y8qlFa">
                  <pre class="language-python"><code class="language-python">daily = "hello"\nprint(daily)</code></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    `;

    setupDoubaoDom(html, "https://www.doubao.com/chat/conv001");

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    loadNormalize();
    loadCollectorUtils();
    loadDoubaoMarkdown();
    loadDoubaoCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.doubao.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).toContain("# 生活随笔");
    expect(assistant.contentMarkdown).toContain("**温柔**");
    expect(assistant.contentMarkdown).toContain("*热牛奶*");
    expect(assistant.contentMarkdown).toContain("- 父级条目");
    expect(assistant.contentMarkdown).toContain("  - 子级条目");
    expect(assistant.contentMarkdown).toContain("> 心若向阳，目之所及皆是美好。");
    expect(assistant.contentMarkdown).toContain("| 物品 | 用途 |");
    expect(assistant.contentMarkdown).toContain("[生活分享平台](https://example.com/life)");
    expect(assistant.contentMarkdown).toContain("```python");
    expect(assistant.contentMarkdown).toContain("print(daily)");
    expect(assistant.contentMarkdown).not.toContain("这是思考内容，不应被抓取");
    expect(assistant.contentMarkdown).not.toContain("运行");
    expect(assistant.contentMarkdown).not.toContain("复制");
  });

  it("falls back to plain text markdown when markdown helper is unavailable", async () => {
    const html = `
      <main data-testid="message_list">
        <div data-testid="union_message">
          <div data-testid="receive_message">
            <div data-testid="message_text_content">plain answer</div>
          </div>
        </div>
      </main>
    `;

    setupDoubaoDom(html, "https://www.doubao.com/chat/fallback001");

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    loadNormalize();
    loadCollectorUtils();
    loadDoubaoCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.doubao.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("assistant");
    expect(snap.messages[0].contentText).toBe("plain answer");
    expect(snap.messages[0].contentMarkdown).toBe("plain answer");
  });
});
