import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import normalizeApi from "../../src/shared/normalize.ts";
import { createCollectorEnv } from "../../src/collectors/collector-env.ts";
import { createGeminiCollectorDef } from "../../src/collectors/gemini/gemini-collector.ts";

function setupGeminiDom(html: string, url: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
  return dom;
}

function deepResearchPanelHtml(title: string, body: string) {
  return `
    <immersive-panel>
      <deep-research-immersive-panel>
        <toolbar>
          <div class="toolbar has-title">
            <div class="left-panel">
              <h2 class="title-text">${title}</h2>
            </div>
          </div>
        </toolbar>
        <div data-test-id="scroll-container" class="container">
          <structured-content-container data-test-id="message-content">
            <message-content id="extended-response-message-content">
              <div class="markdown markdown-main-panel" id="extended-response-markdown-content">
                ${body}
              </div>
            </message-content>
          </structured-content-container>
        </div>
      </deep-research-immersive-panel>
    </immersive-panel>
  `;
}

describe("gemini-collector", () => {
  it("filters out visually hidden speaker labels (cross-language)", async () => {
    const html = `
      <div id="chat-history">
        <div class="conversation-container">
          <user-query>
            <div class="query-text">
              <span class="cdk-visually-hidden">你说</span>
              <div role="status" class="stopped-draft-message gds-body-l gds-italic ng-star-inserted" hidden="">你已让系统停止这条回答</div>
              <p class="query-text-line">你好</p>
            </div>
          </user-query>
          <model-response>
            <div class="model-response-text">
              <h2 class="cdk-visually-hidden ng-star-inserted">Gemini 说</h2>
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
    expect(user.contentText).not.toContain("你已让系统停止这条回答");

    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentText).toContain("世界");
    expect(assistant.contentText).not.toContain("Gemini 说");
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

  it("extracts deep research content from an open immersive panel", async () => {
    const title = "2025 自动驾驶传感器趋势研究";
    const html = `
      <div id="chat-history">
        <div class="conversation-container">
          <user-query><div class="query-text">请继续研究</div></user-query>
          <model-response>
            <div class="model-response-text">
              <p>我已经完成了研究。</p>
              <response-element>
                <immersive-entry-chip>
                  <div data-test-id="container" class="container clickable is-open">
                    <deep-research-entry-chip-content>
                      <div class="content-container">
                        <span data-test-id="title-text" class="title-text">${title}</span>
                      </div>
                    </deep-research-entry-chip-content>
                  </div>
                </immersive-entry-chip>
              </response-element>
            </div>
          </model-response>
        </div>
      </div>
      ${deepResearchPanelHtml(
        title,
        `
          <h1>${title}</h1>
          <h2>第一章</h2>
          <p>这是一份足够长的研究全文，覆盖技术路线、供应链、法规和商业化节奏，用于验证 collector 会优先保存右侧 immersive panel 的正文，而不是只保存 chip 标题。</p>
          <p>第二段继续补足长度，并确保 markdown 提取路径能生成标题、段落和结构化内容。</p>
        `,
      )}
    `;
    const dom = setupGeminiDom(html, "https://gemini.google.com/app/deep001");

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = await Promise.resolve(createGeminiCollectorDef(env).collector.capture()) as any;
    expect(snap).toBeTruthy();
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentText).toContain("供应链");
    expect(assistant.contentText).not.toBe(title);
    expect(assistant.contentMarkdown).toContain(`# ${title}`);
    expect(assistant.contentMarkdown).toContain("## 第一章");
  });

  it("opens deep research chip during manual capture to extract immersive panel content", async () => {
    const title = "2025 自动驾驶传感器趋势研究";
    const html = `
      <div id="chat-history">
        <div class="conversation-container">
          <user-query><div class="query-text">请继续研究</div></user-query>
          <model-response>
            <div class="model-response-text">
              <p>我已经完成了研究。</p>
              <response-element>
                <immersive-entry-chip>
                  <div data-test-id="container" class="container clickable">
                    <deep-research-entry-chip-content>
                      <div class="content-container">
                        <span data-test-id="title-text" class="title-text">${title}</span>
                      </div>
                    </deep-research-entry-chip-content>
                  </div>
                </immersive-entry-chip>
              </response-element>
            </div>
          </model-response>
        </div>
      </div>
    `;
    const dom = setupGeminiDom(html, "https://gemini.google.com/app/deep002");
    const trigger = dom.window.document.querySelector("[data-test-id='container']") as HTMLElement | null;
    let clicked = 0;
    trigger?.addEventListener("click", () => {
      clicked += 1;
      if (dom.window.document.querySelector("deep-research-immersive-panel")) return;
      dom.window.document.body.insertAdjacentHTML(
        "beforeend",
        deepResearchPanelHtml(
          title,
          `
            <h1>${title}</h1>
            <p>右侧展开后的全文包含完整行业研究、法规约束、成本变化和量产节奏，这里用来验证 manual capture 会主动点击 chip 再采集全文。</p>
            <p>这段补齐最小长度，并确保等待面板出现的逻辑能在测试中稳定命中。</p>
          `,
        ),
      );
    });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = await Promise.resolve(createGeminiCollectorDef(env).collector.capture({ manual: true })) as any;
    expect(snap).toBeTruthy();
    expect(clicked).toBe(1);
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentText).toContain("量产节奏");
    expect(assistant.contentMarkdown).toContain("manual capture 会主动点击 chip");
  });

  it("manual capture crawls multiple deep research chips (title-text + artifact-text) and merges reports into the assistant message", async () => {
    const titleA = "2025 自动驾驶传感器趋势研究";
    const titleB = "2025-2026 自动驾驶感知供应链与技术突破报告";

    const html = `
      <div id="chat-history">
        <div class="conversation-container" id="block_multi_1">
          <user-query><div class="query-text">请做两份报告</div></user-query>
          <model-response>
            <div class="model-response-text">
              <p>我已经完成了研究。</p>
              <response-element>
                <immersive-entry-chip>
                  <div data-test-id="container" class="container clickable">
                    <deep-research-entry-chip-content>
                      <div class="content-container">
                        <span data-test-id="title-text" class="title-text">${titleA}</span>
                      </div>
                    </deep-research-entry-chip-content>
                    <div data-test-id="open-button" class="button-section">
                      <button data-test-id="view-report-button" aria-label="在 Canvas 中打开《${titleA}》">打开</button>
                    </div>
                  </div>
                </immersive-entry-chip>
                <immersive-entry-chip>
                  <div data-test-id="container" class="container clickable">
                    <div data-test-id="default-entry-chip-content" class="default-entry-chip-content">
                      <div class="text">
                        <div data-test-id="artifact-text" class="gds-title-m">${titleB}</div>
                      </div>
                    </div>
                    <div data-test-id="open-button" class="button-section">
                      <button data-test-id="view-report-button" aria-label="在 Canvas 中打开《${titleB}》">打开</button>
                    </div>
                  </div>
                </immersive-entry-chip>
              </response-element>
            </div>
          </model-response>
        </div>
      </div>
    `;

    const dom = setupGeminiDom(html, "https://gemini.google.com/app/deep_multi_1");
    const doc = dom.window.document;

    const ensurePanel = (title: string, body: string) => {
      const existing = doc.querySelector("deep-research-immersive-panel");
      if (!existing) {
        doc.body.insertAdjacentHTML("beforeend", deepResearchPanelHtml(title, body));
        return;
      }
      const h2 = existing.querySelector("toolbar h2.title-text");
      if (h2) h2.textContent = title;
      const md = existing.querySelector("#extended-response-markdown-content");
      if (md) md.innerHTML = body;
    };

    const buttons = Array.from(doc.querySelectorAll("button[data-test-id='view-report-button']")) as HTMLElement[];
    expect(buttons.length).toBe(2);

    let clickedA = 0;
    let clickedB = 0;
    const longPad =
      "这是一段用于单测的填充文本，目的是确保右侧面板的正文长度超过最小阈值，从而让 collector 判定为有效报告内容并完成提取与合并。";

    buttons[0]?.addEventListener("click", () => {
      clickedA += 1;
      ensurePanel(
        titleA,
        `
          <h1>${titleA}</h1>
          <p>Report A unique content: 供应链与法规落地节奏的对比分析，用于验证多份报告逐个点开后都能被抓取并写回到对应聊天位置。${longPad}</p>
          <p>第二段继续补足长度，保证 hash 签名会稳定随内容切换变化。${longPad}</p>
        `,
      );
    });
    buttons[1]?.addEventListener("click", () => {
      clickedB += 1;
      ensurePanel(
        titleB,
        `
          <h1>${titleB}</h1>
          <p>Report B unique content: MIPI A-PHY 与关键器件国产化率，用于验证 artifact-text 变体 chip 也能被识别并触发打开。${longPad}</p>
          <p>第二段继续补足长度，用于验证多报告逐个点开后会被 merge 回同一条 assistant 消息。${longPad}</p>
        `,
      );
    });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = await Promise.resolve(createGeminiCollectorDef(env).collector.capture({ manual: true })) as any;
    expect(snap).toBeTruthy();
    expect(clickedA).toBe(1);
    expect(clickedB).toBe(1);
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).toContain("Report A unique content");
    expect(assistant.contentMarkdown).toContain("Report B unique content");
  });

  it("manual capture continues when a later deep research trigger disappears (skips with placeholder)", async () => {
    const titleA = "报告 A";
    const titleB = "报告 B";
    const html = `
      <div id="chat-history">
        <div class="conversation-container" id="block_multi_2">
          <user-query><div class="query-text">两份报告</div></user-query>
          <model-response>
            <div class="model-response-text">
              <response-element>
                <immersive-entry-chip>
                  <div data-test-id="container" class="container clickable">
                    <span data-test-id="title-text" class="title-text">${titleA}</span>
                    <button data-test-id="view-report-button" aria-label="在 Canvas 中打开《${titleA}》">打开</button>
                  </div>
                </immersive-entry-chip>
                <immersive-entry-chip id="chipB">
                  <div data-test-id="container" class="container clickable">
                    <div data-test-id="artifact-text">${titleB}</div>
                    <button data-test-id="view-report-button" aria-label="在 Canvas 中打开《${titleB}》">打开</button>
                  </div>
                </immersive-entry-chip>
              </response-element>
            </div>
          </model-response>
        </div>
      </div>
    `;

    const dom = setupGeminiDom(html, "https://gemini.google.com/app/deep_multi_2");
    const doc = dom.window.document;
    const buttons = Array.from(doc.querySelectorAll("button[data-test-id='view-report-button']")) as HTMLElement[];
    expect(buttons.length).toBe(2);

    const longPad =
      "这是一段用于单测的填充文本，目的是确保右侧面板的正文长度超过最小阈值，从而让 collector 判定为有效报告内容并完成提取与合并。";

    buttons[0]?.addEventListener("click", () => {
      // Simulate DOM re-render that removes the later trigger.
      doc.querySelector("#chipB")?.remove();
      doc.body.insertAdjacentHTML(
        "beforeend",
        deepResearchPanelHtml(
          titleA,
          `
            <h1>${titleA}</h1>
            <p>Report A content long enough to be extracted and merged. ${longPad}</p>
            <p>Second paragraph to satisfy minimum length requirement and keep signature stable. ${longPad}</p>
          `,
        ),
      );
    });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = await Promise.resolve(createGeminiCollectorDef(env).collector.capture({ manual: true })) as any;
    expect(snap).toBeTruthy();
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).toContain("Report A content long enough");
    expect(assistant.contentMarkdown).toContain("未抓到全文");
  });
});
