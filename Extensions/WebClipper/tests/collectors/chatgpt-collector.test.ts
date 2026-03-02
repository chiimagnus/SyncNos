import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ensureCollectorUtils } from "../helpers/collectors-bootstrap";

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

async function loadCollectorUtils() {
  return ensureCollectorUtils();
}

async function loadChatgptMarkdown() {
  return import("../../src/collectors/chatgpt/chatgpt-markdown.ts");
}

async function loadChatgptCollector() {
  return import("../../src/collectors/chatgpt/chatgpt-collector.ts");
}

function setupChatgptDom(html: string, url: string) {
  const dom = new JSDOM(`<body><main>${html}</main></body>`, { url });
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

describe("chatgpt-collector", () => {
  it("extracts assistant contentMarkdown from semantic markdown DOM", async () => {
    const html = `
      <article data-testid="conversation-turn-1">
        <div data-message-author-role="user"><div class="whitespace-pre-wrap">你好</div></div>
      </article>
      <article data-testid="conversation-turn-2">
        <div data-message-author-role="assistant" data-message-id="m_ai_1">
          <div class="markdown prose">
            <h1>主标题</h1>
            <blockquote><p>这是引用</p></blockquote>
            <ul>
              <li>
                <p>父级条目</p>
                <ul>
                  <li><p>子级条目</p></li>
                </ul>
              </li>
            </ul>
            <ol start="3"><li><p>第三项</p></li></ol>
            <table>
              <thead><tr><th>类型</th><th>特征</th></tr></thead>
              <tbody><tr><td>深度工作</td><td>高专注</td></tr></tbody>
            </table>
            <pre>
              <div class="relative">
                <div class="sticky"><div>代码</div><button aria-label="复制">复制</button></div>
                <div id="code-block-viewer" class="cm-editor">
                  <div class="cm-scroller">
                    <div class="cm-content"><span>const a = 1;</span><br><span>console.log(a);</span></div>
                  </div>
                </div>
              </div>
            </pre>
            <p><strong>粗体</strong> <em>斜体</em> <code>sum(1,2)</code> <a href="https://example.com">链接</a></p>
            <hr />
          </div>
        </div>
      </article>
    `;

    setupChatgptDom(html, "https://chatgpt.com/c/conv_md_1");

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    await loadCollectorUtils();
    await loadChatgptMarkdown();
    await loadChatgptCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.chatgpt.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);

    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).toContain("# 主标题");
    expect(assistant.contentMarkdown).toContain("> 这是引用");
    expect(assistant.contentMarkdown).toContain("- 父级条目");
    expect(assistant.contentMarkdown).toContain("  - 子级条目");
    expect(assistant.contentMarkdown).toContain("3. 第三项");
    expect(assistant.contentMarkdown).toContain("| 类型 | 特征 |");
    expect(assistant.contentMarkdown).toContain("```");
    expect(assistant.contentMarkdown).toContain("const a = 1;");
    expect(assistant.contentMarkdown).toContain("console.log(a);");
    expect(assistant.contentMarkdown).toContain("**粗体**");
    expect(assistant.contentMarkdown).toContain("*斜体*");
    expect(assistant.contentMarkdown).toContain("`sum(1,2)`");
    expect(assistant.contentMarkdown).toContain("[链接](https://example.com)");
    expect(assistant.contentMarkdown).toContain("---");
    expect(assistant.contentMarkdown).not.toContain("复制");

    expect(assistant.contentText).toContain("主标题");
    expect(assistant.contentText).toContain("console.log(a);");
    expect(assistant.contentText).not.toContain("复制");
  });

  it("falls back to plain text markdown when markdown helper is unavailable", async () => {
    const html = `
      <article data-testid="conversation-turn-1">
        <div data-message-author-role="assistant">
          <div class="markdown prose"><p>plain answer</p></div>
        </div>
      </article>
    `;

    setupChatgptDom(html, "https://chatgpt.com/c/conv_fallback_1");

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    await loadCollectorUtils();
    await loadChatgptCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.chatgpt.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("assistant");
    expect(snap.messages[0].contentText).toBe("plain answer");
    expect(snap.messages[0].contentMarkdown).toBe("plain answer");
  });
});
