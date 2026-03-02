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

async function loadKimiMarkdown() {
  return import("../../src/collectors/kimi/kimi-markdown.ts");
}

async function loadKimiCollector() {
  return import("../../src/collectors/kimi/kimi-collector.ts");
}

function setupKimiDom(html: string, url: string) {
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

describe("kimi-collector", () => {
  it("extracts assistant contentMarkdown from semantic markdown DOM", async () => {
    const html = `
      <main class="chat-content">
        <div class="chat-content-item chat-content-item-user">
          <div class="user-content">你好</div>
        </div>
        <div class="chat-content-item chat-content-item-assistant">
          <div class="markdown-container">
            <div class="markdown">
              <h1>GitHub Actions 自动化部署</h1>
              <blockquote><div class="paragraph">CI/CD 是现代开发的重要实践。</div></blockquote>
              <h2>准备工作</h2>
              <ol start="1">
                <li><div class="paragraph">配置 <code class="segment-code-inline">npm</code> 脚本</div></li>
                <li><div class="paragraph">准备好仓库</div></li>
              </ol>
              <div class="segment-code">
                <header class="segment-code-header">
                  <div class="segment-code-header-content">
                    <span class="segment-code-lang">yaml</span>
                    <button>复制</button>
                  </div>
                </header>
                <div class="segment-code-content">
                  <pre class="language-yaml"><code class="language-yaml">name: CI\non:\n  push:\n    branches: [ main ]</code></pre>
                </div>
              </div>
              <div class="table markdown-table">
                <header class="table-actions"><span class="table-title">表格</span><button>复制</button></header>
                <div class="table-container">
                  <table>
                    <thead><tr><th align="left">事件</th><th align="left">说明</th></tr></thead>
                    <tbody><tr><td align="left"><code class="segment-code-inline">push</code></td><td align="left">触发部署</td></tr></tbody>
                  </table>
                </div>
              </div>
              <ul>
                <li><div class="paragraph"><a href="https://docs.github.com/en/actions">Actions 文档</a></div></li>
              </ul>
              <hr />
            </div>
          </div>
          <div class="segment-assistant-actions"><button>复制</button></div>
        </div>
      </main>
    `;

    setupKimiDom(html, "https://kimi.com/chat/conv001");

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    loadCollectorUtils();
    await loadKimiMarkdown();
    await loadKimiCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.kimi.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).toContain("# GitHub Actions 自动化部署");
    expect(assistant.contentMarkdown).toContain("> CI/CD 是现代开发的重要实践。");
    expect(assistant.contentMarkdown).toContain("## 准备工作");
    expect(assistant.contentMarkdown).toContain("1. 配置 `npm` 脚本");
    expect(assistant.contentMarkdown).toContain("```yaml");
    expect(assistant.contentMarkdown).toContain("branches: [ main ]");
    expect(assistant.contentMarkdown).toContain("| 事件 | 说明 |");
    expect(assistant.contentMarkdown).toContain("`push`");
    expect(assistant.contentMarkdown).toContain("[Actions 文档](https://docs.github.com/en/actions)");
    expect(assistant.contentMarkdown).toContain("---");
    expect(assistant.contentMarkdown).not.toContain("复制");
  });

  it("falls back to plain text markdown when markdown helper is unavailable", async () => {
    const html = `
      <main class="chat-content">
        <div class="chat-content-item chat-content-item-assistant">
          <div class="markdown-container"><div>plain answer</div></div>
        </div>
      </main>
    `;

    setupKimiDom(html, "https://kimi.com/chat/fallback001");

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    loadCollectorUtils();
    await loadKimiCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.kimi.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("assistant");
    expect(snap.messages[0].contentText).toBe("plain answer");
    expect(snap.messages[0].contentMarkdown).toBe("plain answer");
  });
});
