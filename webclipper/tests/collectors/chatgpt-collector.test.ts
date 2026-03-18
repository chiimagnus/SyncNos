import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import normalizeApi from "../../src/shared/normalize.ts";
import { createCollectorEnv } from "../../src/collectors/collector-env.ts";
import { createChatgptCollectorDef } from "../../src/collectors/chatgpt/chatgpt-collector.ts";

function setupChatgptDom(html: string, url: string) {
  const dom = new JSDOM(`<body><main>${html}</main></body>`, { url });
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

    const dom = setupChatgptDom(html, "https://chatgpt.com/c/conv_md_1");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = await Promise.resolve(createChatgptCollectorDef(env).collector.capture({ manual: true })) as any;
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

  it("extracts multiple assistant messages inside an agent-turn container", async () => {
    const html = `
      <div data-message-author-role="user"><div class="whitespace-pre-wrap">Q</div></div>
      <div class="group/turn-messages flex flex-col agent-turn">
        <div data-message-author-role="assistant" data-message-id="m_ai_1" class="text-message">
          <div class="markdown prose"><p>first</p></div>
        </div>
        <div class="flex items-center justify-between">
          <button type="button">Thought for 1s</button>
        </div>
        <div data-message-author-role="assistant" data-message-id="m_ai_2" class="text-message">
          <div class="markdown prose"><p>second</p></div>
        </div>
      </div>
    `;

    const dom = setupChatgptDom(html, "https://chatgpt.com/c/conv_agent_turn_1");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = await Promise.resolve(createChatgptCollectorDef(env).collector.capture({ manual: true })) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(snap.messages.map((m: any) => m.contentText)).toEqual(["Q", "first", "second"]);
  });

  it("preserves hidden mermaid code blocks that are rendered as diagrams", async () => {
    const html = `
      <article data-testid="conversation-turn-1">
        <div data-message-author-role="assistant" data-message-id="m_ai_mermaid">
          <div class="markdown prose">
            <p>下面是一个 mermaid：</p>
            <div class="mermaid">
              <svg aria-hidden="true"><path d="M0 0" /></svg>
              <pre class="sr-only" aria-hidden="true"><code class="language-mermaid">graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[OK]\n  B -->|No| D[Retry]</code></pre>
            </div>
          </div>
        </div>
      </article>
    `;

    const dom = setupChatgptDom(html, "https://chatgpt.com/c/conv_mermaid_1");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await Promise.resolve(createChatgptCollectorDef(env).collector.capture({ manual: true }))) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("assistant");
    expect(snap.messages[0].contentMarkdown).toContain("```mermaid");
    expect(snap.messages[0].contentMarkdown).toContain("graph TD");
    expect(snap.messages[0].contentText).toContain("graph TD");
  });

  it("captures deep-research iframe content via postMessage", async () => {
    const html = `
      <div data-message-author-role="assistant" data-message-id="m_ai_prev">
        <div class="markdown prose"><p>previous</p></div>
      </div>
      <article data-testid="conversation-turn-4" data-turn="assistant" data-turn-id="t1">
        <div class="agent-turn">
          <iframe title="internal://deep-research" src="https://connector_openai_deep_research.web-sandbox.oaiusercontent.com/?app=chatgpt"></iframe>
        </div>
      </article>
    `;

    const dom = setupChatgptDom(html, "https://chatgpt.com/c/conv_deep_research_1");
    const iframe = dom.window.document.querySelector('iframe') as any;
    expect(iframe).toBeTruthy();

    const fakeFrameWindow = {
      postMessage: (msg: any) => {
        const requestId = msg?.requestId;
        dom.window.dispatchEvent(
          new (dom.window as any).MessageEvent('message', {
            data: {
              __syncnos: true,
              type: 'SYNCNOS_DEEP_RESEARCH_RESPONSE',
              requestId,
              title: 'Report',
              markdown: '# Title\n\nBody',
              text: 'Title\n\nBody',
            },
            origin: 'https://connector_openai_deep_research.web-sandbox.oaiusercontent.com',
            source: fakeFrameWindow as any,
          }),
        );
      },
    };
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: fakeFrameWindow });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = await Promise.resolve(createChatgptCollectorDef(env).collector.capture({ manual: true })) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    expect(snap.messages[0].contentText).toContain('previous');
    expect(snap.messages[1].role).toBe('assistant');
    expect(snap.messages[1].contentMarkdown).toContain('# Title');
    expect(snap.messages[1].contentText).toContain('Body');
  });

  it("captures deep-research iframe inside section conversation-turn wrappers", async () => {
    const html = `
      <section data-testid="conversation-turn-1" data-turn="user">
        <div data-message-author-role="user"><div class="whitespace-pre-wrap">Q</div></div>
      </section>
      <section data-testid="conversation-turn-2" data-turn="assistant" data-turn-id="t2">
        <h4 class="sr-only select-none">ChatGPT said:</h4>
        <div class="agent-turn">
          <iframe title="internal://deep-research" src="https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop"></iframe>
        </div>
      </section>
    `;

    const dom = setupChatgptDom(html, "https://chatgpt.com/c/conv_deep_research_section_1");
    const iframe = dom.window.document.querySelector("iframe") as any;
    expect(iframe).toBeTruthy();

    const fakeFrameWindow = {
      postMessage: (msg: any) => {
        const requestId = msg?.requestId;
        dom.window.dispatchEvent(
          new (dom.window as any).MessageEvent("message", {
            data: {
              __syncnos: true,
              type: "SYNCNOS_DEEP_RESEARCH_RESPONSE",
              requestId,
              title: "Report",
              markdown: "# Title\n\nBody",
              text: "Title\n\nBody",
            },
            origin: "https://connector_openai_deep_research.web-sandbox.oaiusercontent.com",
            source: fakeFrameWindow as any,
          }),
        );
      },
    };
    Object.defineProperty(iframe, "contentWindow", { configurable: true, value: fakeFrameWindow });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await Promise.resolve(createChatgptCollectorDef(env).collector.capture({ manual: true }))) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(snap.messages[0].contentText).toBe("Q");
    expect(snap.messages[1].contentMarkdown).toContain("# Title");
    expect(snap.messages[1].contentText).toContain("Body");
  });

  it("captures multiple deep-research iframes with identical src as distinct reports", async () => {
    const html = `
      <section data-testid="conversation-turn-1" data-turn="user" data-turn-id="u1">
        <div data-message-author-role="user"><div class="whitespace-pre-wrap">Q</div></div>
      </section>
      <section data-testid="conversation-turn-2" data-turn="assistant" data-turn-id="a1">
        <div class="agent-turn">
          <iframe title="internal://deep-research" src="https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop"></iframe>
        </div>
      </section>
      <section data-testid="conversation-turn-3" data-turn="assistant" data-turn-id="a2">
        <div class="agent-turn">
          <iframe title="internal://deep-research" src="https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop"></iframe>
        </div>
      </section>
      <section data-testid="conversation-turn-4" data-turn="assistant" data-turn-id="a3">
        <div class="agent-turn">
          <iframe title="internal://deep-research" src="https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop"></iframe>
        </div>
      </section>
    `;

    const dom = setupChatgptDom(html, "https://chatgpt.com/c/conv_deep_research_multi_1");
    const iframes = Array.from(dom.window.document.querySelectorAll("iframe")) as any[];
    expect(iframes.length).toBe(3);

    const mkFrame = (title: string, body: string) => {
      const win = {
        postMessage: (msg: any) => {
          const requestId = msg?.requestId;
          dom.window.dispatchEvent(
            new (dom.window as any).MessageEvent("message", {
              data: {
                __syncnos: true,
                type: "SYNCNOS_DEEP_RESEARCH_RESPONSE",
                requestId,
                title,
                markdown: `# ${title}\n\n${body}`,
                text: `${title}\n\n${body}`,
              },
              origin: "https://connector_openai_deep_research.web-sandbox.oaiusercontent.com",
              source: win as any,
            }),
          );
        },
      };
      return win;
    };

    const w1 = mkFrame("Report A", "Body A");
    const w2 = mkFrame("Report A", "Body A");
    const w3 = mkFrame("Report B", "Body B");
    Object.defineProperty(iframes[0], "contentWindow", { configurable: true, value: w1 });
    Object.defineProperty(iframes[1], "contentWindow", { configurable: true, value: w2 });
    Object.defineProperty(iframes[2], "contentWindow", { configurable: true, value: w3 });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await Promise.resolve(createChatgptCollectorDef(env).collector.capture({ manual: true }))) as any;
    expect(snap).toBeTruthy();
    const assistant = snap.messages.filter((m: any) => m.role === "assistant");
    expect(assistant.length).toBe(3);
    expect(assistant[0].contentText).toContain("Body A");
    expect(assistant[1].contentText).toContain("Body A");
    expect(assistant[2].contentText).toContain("Body B");
    expect(assistant[0].contentText).not.toBe(assistant[2].contentText);
  });

  it("falls back to deep-research placeholder when iframe extraction returns empty, even with sr-only label", async () => {
    const html = `
      <article data-testid="conversation-turn-4" data-turn="assistant" data-turn-id="t1">
        <h6 class="sr-only select-none">ChatGPT说:</h6>
        <div class="agent-turn">
          <iframe title="internal://deep-research" src="https://connector_openai_deep_research.web-sandbox.oaiusercontent.com/?app=chatgpt&locale=zh-CN"></iframe>
        </div>
      </article>
    `;

    const dom = setupChatgptDom(html, "https://chatgpt.com/c/conv_deep_research_fallback_1");
    const iframe = dom.window.document.querySelector("iframe") as any;
    expect(iframe).toBeTruthy();

    const fakeFrameWindow = {
      postMessage: (msg: any) => {
        const requestId = msg?.requestId;
        dom.window.dispatchEvent(
          new (dom.window as any).MessageEvent("message", {
            data: {
              __syncnos: true,
              type: "SYNCNOS_DEEP_RESEARCH_RESPONSE",
              requestId,
              title: "Deep Research",
              markdown: "",
              text: "",
            },
            origin: "https://connector_openai_deep_research.web-sandbox.oaiusercontent.com",
            source: fakeFrameWindow as any,
          }),
        );
      },
    };
    Object.defineProperty(iframe, "contentWindow", { configurable: true, value: fakeFrameWindow });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = await Promise.resolve(createChatgptCollectorDef(env).collector.capture({})) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("assistant");
    expect(String(snap.messages[0].contentText)).toMatch(/^Deep Research \(iframe\):/);
    expect(String(snap.messages[0].contentText)).toContain("connector_openai_deep_research.web-sandbox.oaiusercontent.com");
    expect(String(snap.messages[0].contentText)).not.toContain("ChatGPT说");
  });

  it("falls back to plain text markdown when markdown helper is unavailable", async () => {
    const html = `
      <article data-testid="conversation-turn-1">
        <div data-message-author-role="assistant">
          <div class="markdown prose"><p>plain answer</p></div>
        </div>
      </article>
    `;

    vi.resetModules();
    vi.doMock("../../src/collectors/chatgpt/chatgpt-markdown.ts", () => ({ default: {} }));

    const dom = setupChatgptDom(html, "https://chatgpt.com/c/conv_fallback_1");
    const { createChatgptCollectorDef: createDef } = await import("../../src/collectors/chatgpt/chatgpt-collector.ts");

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = await Promise.resolve(createDef(env).collector.capture({ manual: true })) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("assistant");
    expect(snap.messages[0].contentText).toBe("plain answer");
    expect(snap.messages[0].contentMarkdown).toBe("plain answer");
  });
});
