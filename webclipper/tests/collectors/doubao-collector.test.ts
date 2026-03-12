import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import normalizeApi from "../../src/shared/normalize.ts";
import { createCollectorEnv } from "../../src/collectors/collector-env.ts";
import { createDoubaoCollectorDef } from "../../src/collectors/doubao/doubao-collector.ts";

function setupDoubaoDom(html: string, url: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
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

    const dom = setupDoubaoDom(html, "https://www.doubao.com/chat/conv001");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const snap = (await Promise.resolve(createDoubaoCollectorDef(env).collector.capture())) as any;
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

    vi.resetModules();
    vi.doMock("../../src/collectors/doubao/doubao-markdown.ts", () => ({ default: {} }));

    const dom = setupDoubaoDom(html, "https://www.doubao.com/chat/fallback001");
    const { createDoubaoCollectorDef: createDef } = await import("../../src/collectors/doubao/doubao-collector.ts");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const snap = (await Promise.resolve(createDef(env).collector.capture())) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("assistant");
    expect(snap.messages[0].contentText).toBe("plain answer");
    expect(snap.messages[0].contentMarkdown).toBe("plain answer");
  });

  it("inlines blob: uploaded images as data:image urls", async () => {
    const blobUrl = "blob:https://www.doubao.com/ee26c19d-9884-4cd8-8bcf-6b7ba6436f0f";
    const data = new Uint8Array([0, 1, 2, 3, 4, 5]);

    const html = `
      <main data-testid="message_list">
        <div data-testid="union_message">
          <div data-testid="send_message">
            <div data-testid="message_text_content">解释图片</div>
            <img decoding="async" width="1080" height="1352" src="${blobUrl}">
          </div>
          <div data-testid="receive_message">
            <div data-testid="message_text_content">好的</div>
          </div>
        </div>
      </main>
    `;

    const dom = setupDoubaoDom(html, "https://www.doubao.com/chat/blob001");
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

    const snap = (await Promise.resolve(createDoubaoCollectorDef(env).collector.capture())) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    const user = snap.messages.find((m: { role: string }) => m.role === "user");
    expect(user).toBeTruthy();
    expect(user.contentMarkdown).toContain("![](data:image/png");
  });
});
