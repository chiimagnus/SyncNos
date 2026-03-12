import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import normalizeApi from "../../src/shared/normalize.ts";
import { createCollectorEnv } from "../../src/collectors/collector-env.ts";
import { createKimiCollectorDef } from "../../src/collectors/kimi/kimi-collector.ts";

function setupKimiDom(html: string, url: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
  return dom;
}

describe("kimi-collector", () => {
  it("captures user uploaded images from attachment list", () => {
    const html = `
      <main class="chat-content">
        <div class="chat-content-item chat-content-item-user">
          <div class="attachment-list">
            <div class="attachment-list-image single">
              <div class="image-thumbnail large success">
                <span class="image-wrapper image-detail">
                  <img class="image-main is-cover" alt="" src="https://www.kimi.com/apiv2-files/sign-obj/kimi-fs/files/blob/abc?filename=1.jpg&sig=xxx&t=t">
                </span>
              </div>
            </div>
          </div>
          <div class="segment-content">
            <div class="segment-content-box">
              <div class="user-content">这是什么</div>
            </div>
          </div>
        </div>
      </main>
    `;

    const dom = setupKimiDom(html, "https://kimi.com/chat/img001");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = createKimiCollectorDef(env).collector.capture() as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("user");
    expect(snap.messages[0].contentMarkdown).toContain("这是什么");
    expect(snap.messages[0].contentMarkdown).toContain("![](https://www.kimi.com/apiv2-files/sign-obj/");
  });

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

    const dom = setupKimiDom(html, "https://kimi.com/chat/conv001");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = createKimiCollectorDef(env).collector.capture() as any;
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

    vi.resetModules();
    vi.doMock("../../src/collectors/kimi/kimi-markdown.ts", () => ({ default: {} }));

    const dom = setupKimiDom(html, "https://kimi.com/chat/fallback001");
    const { createKimiCollectorDef: createDef } = await import("../../src/collectors/kimi/kimi-collector.ts");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = createDef(env).collector.capture() as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("assistant");
    expect(snap.messages[0].contentText).toBe("plain answer");
    expect(snap.messages[0].contentMarkdown).toBe("plain answer");
  });
});
