import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { createCollectorEnv } from "../../src/collectors/collector-env.ts";
import { createZaiCollectorDef } from "../../src/collectors/zai/zai-collector.ts";
import normalizeApi from "../../src/shared/normalize.ts";

function setupDom(dom: JSDOM) {
  // @ts-expect-error test global
  globalThis.window = dom.window;
  // @ts-expect-error test global
  globalThis.document = dom.window.document;
  // @ts-expect-error test global
  globalThis.Node = dom.window.Node;
  // @ts-expect-error test global
  globalThis.location = dom.window.location;
  // @ts-expect-error test global
  globalThis.getComputedStyle = dom.window.getComputedStyle;
}

function createCollector() {
  const env = createCollectorEnv({
    // @ts-expect-error test global
    window: globalThis.window,
    // @ts-expect-error test global
    document: globalThis.document,
    // @ts-expect-error test global
    location: globalThis.location,
    normalize: normalizeApi,
  });
  return createZaiCollectorDef(env).collector as any;
}

describe("zai-collector", () => {
  it("captures user uploaded images from attachment card", async () => {
    const html = `
      <div id="message-u1" class="user-message">
        <div class="chat-user markdown-prose">
          <div class="flex overflow-x-auto flex-col flex-wrap gap-1 justify-end mt-2.5 mb-1 w-full">
            <div class="self-end">
              <button class="not-prose" type="button">
                <img
                  src="https://z-cdn-media.chatglm.cn/files/dd5bd44e-1d27-4ff6-9966-c82967dead55.jpg?auth_key=abc"
                  alt="1.jpg"
                  data-cy="image"
                />
              </button>
            </div>
          </div>
          <div class="relative w-full">
            <div class="whitespace-pre-wrap">这是什么？</div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://chat.z.ai/c/conv-img1" });
    setupDom(dom);
    const collector = createCollector();
    const snap = collector.capture() as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe("user");
    expect(snap.messages[0].contentMarkdown).toContain("这是什么？");
    expect(snap.messages[0].contentMarkdown).toContain("![](https://z-cdn-media.chatglm.cn/files/");
  });

  it("ignores thinking-chain-container content", async () => {

    const html = `
      <div id="message-1">
        <div class="chat-assistant">
          <div id="response-content-container">
            <div class="markdown-prose">
              <div data-direct="false" class="w-full thinking-chain-container">
                <button><span>思考过程</span></button>
              </div>
              <div class="w-full overflow-hidden h-0">
                <div class="thinking-block w-full h-full">
                  <blockquote slot="content"><p>这里是思维链内容，应该被忽略。</p></blockquote>
                </div>
              </div>
              <p>这是最终回答内容。</p>
            </div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://chat.z.ai/c/conv1" });
    setupDom(dom);
    const collector = createCollector();

    const wrapper = dom.window.document.querySelector("#message-1");
    const text = collector.__test.extractAssistantText(wrapper);
    expect(text).toContain("这是最终回答内容。");
    expect(text).not.toContain("思考过程");
    expect(text).not.toContain("思维链内容");
  });

  it("extracts assistant markdown from rendered HTML", async () => {

    const html = `
      <div id="message-3">
        <div class="chat-assistant">
          <div id="response-content-container">
            <div class="markdown-prose">
              <p><strong>Bold</strong> and <em>italic</em> with <a href="https://example.com">link</a> and <code>x = 1</code>.</p>
              <ul>
                <li>Item A</li>
                <li>Item B</li>
              </ul>
              <pre><code class="language-js">console.log(1);\nconsole.log(2);</code></pre>
            </div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://chat.z.ai/c/conv3" });
    setupDom(dom);
    const collector = createCollector();

    const wrapper = dom.window.document.querySelector("#message-3");
    const md = collector.__test.extractAssistantMarkdown(wrapper);
    expect(md).toContain("**Bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("[link](https://example.com)");
    expect(md).toContain("`x = 1`");
    expect(md).toContain("- Item A");
    expect(md).toContain("- Item B");
    expect(md).toContain("```js");
    expect(md).toContain("console.log(1);");
    expect(md).toContain("```");
  });

  it("does not leak UI button labels when falling back to wrapper", async () => {

    const html = `
      <div id="message-2">
        <div class="chat-assistant">
          <div class="markdown-prose">
            <div data-direct="false" class="thinking-chain-container">
              <button><span>思考过程</span></button>
            </div>
            <div class="w-full overflow-hidden h-0">
              <div class="thinking-block w-full h-full">
                <blockquote slot="content"><p>should be ignored</p></blockquote>
              </div>
            </div>
            <p>Hello answer</p>
          </div>
          <div class="buttons">
            <button aria-label="复制">复制</button>
            <button aria-label="重新生成">重新生成</button>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://chat.z.ai/c/conv2" });
    setupDom(dom);
    const collector = createCollector();

    const wrapper = dom.window.document.querySelector("#message-2");
    const text = collector.__test.extractAssistantText(wrapper);
    expect(text).toContain("Hello answer");
    expect(text).not.toContain("复制");
    expect(text).not.toContain("重新生成");
  });
});
