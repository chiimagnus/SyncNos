import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import normalizeApi from "../../src/shared/normalize.ts";
import { createCollectorEnv } from "../../src/collectors/collector-env.ts";
import { createYuanbaoCollectorDef } from "../../src/collectors/yuanbao/yuanbao-collector.ts";

function setupYuanbaoDom(html: string, url: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
  return dom;
}

describe("yuanbao-collector", () => {
  it("extracts assistant contentMarkdown from semantic markdown DOM", async () => {
    const html = `
      <main class="agent-chat__list__content">
        <div class="agent-chat__list__item--human">
          <div class="hyc-content-text">你好</div>
        </div>
        <div class="agent-chat__list__item--ai">
          <div class="agent-chat__speech-text">
            <div class="hyc-content-md">
              <div class="hyc-common-markdown hyc-common-markdown-style">
                <h1>主标题</h1>
                <div class="ybc-p"><strong>粗体</strong> 与 <em>斜体</em>，以及 <code class="hyc-common-markdown__code__inline">inline()</code></div>
                <ol class="ybc-ol-component">
                  <li class="ybc-li-component ybc-li-component_ol">
                    <span class="ybc-li-component__dot-wp"><span class="ybc-li-component_dot">1.</span></span>
                    <span class="ybc-li-component_content">
                      <div class="ybc-p">父级条目</div>
                      <ul class="ybc-ul-component">
                        <li class="ybc-li-component ybc-li-component_ul">
                          <span class="ybc-li-component__dot-wp"><span class="ybc-li-component_dot">∙</span></span>
                          <span class="ybc-li-component_content"><div class="ybc-p">子级条目</div></span>
                        </li>
                      </ul>
                    </span>
                  </li>
                </ol>
                <blockquote><div class="ybc-p">引用内容</div></blockquote>
                <table>
                  <thead><tr><th><div class="ybc-p">列1</div></th><th><div class="ybc-p">列2</div></th></tr></thead>
                  <tbody><tr><td><div class="ybc-p">A</div></td><td><div class="ybc-p">B</div></td></tr></tbody>
                </table>
                <div class="ybc-p">
                  <span class="hyc-common-markdown__link hyc-common-markdown__link-with-icon">
                    <span class="hyc-common-markdown__link__content">https://example.com/spring.jpg</span>
                    <svg class="hyc-common-markdown__link__content-icon"></svg>
                  </span>
                  与
                  <a href="https://example.com/wiki">百科链接</a>
                </div>
                <pre class="ybc-pre-component">
                  <div class="hyc-common-markdown__code">
                    <div class="hyc-common-markdown__code__hd">
                      <div class="hyc-common-markdown__code__hd__l">python</div>
                      <div class="hyc-common-markdown__code__hd__r">
                        <div class="hyc-common-markdown__code__option"><span class="hyc-common-markdown__code__option__text">下载</span></div>
                        <div class="hyc-common-markdown__code__option"><span class="hyc-common-markdown__code__option__text">复制</span></div>
                        <div class="hyc-common-markdown__code__option"><span class="hyc-common-markdown__code__option__text">运行</span></div>
                      </div>
                    </div>
                    <pre><code class="language-python">print("hi")\nprint("yuanbao")</code></pre>
                  </div>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </main>
    `;

    const dom = setupYuanbaoDom(html, "https://yuanbao.tencent.com/chat/a/b");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const snap = createYuanbaoCollectorDef(env).collector.capture() as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    const assistant = snap.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).toContain("# 主标题");
    expect(assistant.contentMarkdown).toContain("**粗体**");
    expect(assistant.contentMarkdown).toContain("*斜体*");
    expect(assistant.contentMarkdown).toContain("`inline()`");
    expect(assistant.contentMarkdown).toContain("1. 父级条目");
    expect(assistant.contentMarkdown).toContain("  - 子级条目");
    expect(assistant.contentMarkdown).toContain("> 引用内容");
    expect(assistant.contentMarkdown).toContain("| 列1 | 列2 |");
    expect(assistant.contentMarkdown).toContain("[https://example.com/spring.jpg](https://example.com/spring.jpg)");
    expect(assistant.contentMarkdown).toContain("[百科链接](https://example.com/wiki)");
    expect(assistant.contentMarkdown).toContain("```python");
    expect(assistant.contentMarkdown).toContain("print(\"yuanbao\")");
    expect(assistant.contentMarkdown).not.toContain("下载");
    expect(assistant.contentMarkdown).not.toContain("复制");
    expect(assistant.contentMarkdown).not.toContain("运行");
  });

  it("falls back to plain text markdown when markdown helper is unavailable", async () => {
    const html = `
      <main class="agent-chat__list__content">
        <div class="agent-chat__list__item--ai">
          <div class="agent-chat__speech-text">plain answer</div>
        </div>
      </main>
    `;

    vi.resetModules();
    vi.doMock("../../src/collectors/yuanbao/yuanbao-markdown.ts", () => ({ default: {} }));

    const dom = setupYuanbaoDom(html, "https://yuanbao.tencent.com/chat/a/fallback");
    const { createYuanbaoCollectorDef: createDef } = await import("../../src/collectors/yuanbao/yuanbao-collector.ts");
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

  it("captures multimodal image urls from the message bubble", async () => {
    const html = `
      <main class="agent-chat__list__content">
        <div class="agent-chat__list__item agent-chat__list__item--human">
          <div class="agent-chat__bubble agent-chat__bubble--human agent-chat__conv--human agent-chat__conv--human-multimodal">
            <div class="agent-chat__bubble__prefix">
              <div class="hyc-component-multi-modal">
                <div class="hyc-component-multi-modal__item hyc-component-multi-modal__text">
                  <div class="hyc-content-text">这是什么？</div>
                </div>
                <div class="hyc-component-multi-modal__item hyc-component-multi-modal__image">
                  <div class="hyc-content-img hyc-content-img--multi" data-index="1">
                    <img src="https://yuanbao.tencent.com/api/resource/download?resourceId=047f08de22d62597cb92c6dd570068be" draggable="false" alt="">
                  </div>
                </div>
              </div>
            </div>
            <div class="agent-chat__bubble__content">
              <div class="hyc-content-text">这是什么？</div>
            </div>
          </div>
        </div>
      </main>
    `;

    const dom = setupYuanbaoDom(html, "https://yuanbao.tencent.com/chat/a/multimodal");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const snap = createYuanbaoCollectorDef(env).collector.capture() as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("user");
    expect(snap.messages[0].contentText).toContain("这是什么？");
    expect(snap.messages[0].contentMarkdown).toContain("![](https://yuanbao.tencent.com/api/resource/download?resourceId=047f08de22d62597cb92c6dd570068be)");
  });

  it("wraps katex formulas as $...$ (best-effort)", async () => {
    const html = `
      <main class="agent-chat__list__content">
        <div class="agent-chat__list__item agent-chat__list__item--ai">
          <div class="agent-chat__speech-text">
            <div class="hyc-content-md">
              <div class="hyc-common-markdown hyc-common-markdown-style">
                <div class="ybc-p">
                  公式：
                  <span class="ybc-markdown-katex">
                    <span class="katex">
                      <span class="katex-html" aria-hidden="true">
                        <span class="base"><span class="mord mathnormal">E</span><span class="mrel">=</span></span>
                        <span class="base">
                          <span class="mord mathnormal">m</span>
                          <span class="mord"><span class="mord mathnormal">c</span><span class="msupsub"><span class="vlist-t"><span class="vlist-r"><span class="vlist"><span style="top:-3.063em;"><span class="mord mtight">2</span></span></span></span></span></span></span>
                        </span>
                      </span>
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    `;

    const dom = setupYuanbaoDom(html, "https://yuanbao.tencent.com/chat/a/formula");
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const snap = createYuanbaoCollectorDef(env).collector.capture() as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("assistant");
    expect(snap.messages[0].contentMarkdown).toMatch(/\$E\s*=\s*m\s*c\s*2\$/);
  });
});
