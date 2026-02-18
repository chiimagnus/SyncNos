import { describe, expect, it } from "vitest";

function loadNormalize() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/shared/normalize.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/shared/normalize.js");
}

function loadZaiCollector() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/zai-collector.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/zai-collector.js");
}

describe("zai-collector", () => {
  it("ignores thinking-chain-container content", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

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
    // @ts-expect-error test global
    globalThis.window = dom.window;
    // @ts-expect-error test global
    globalThis.document = dom.window.document;
    // @ts-expect-error test global
    globalThis.Node = dom.window.Node;
    // @ts-expect-error test global
    globalThis.location = dom.window.location;

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    loadNormalize();
    const collector = loadZaiCollector();

    const wrapper = dom.window.document.querySelector("#message-1");
    const text = collector.__test.extractAssistantText(wrapper);
    expect(text).toContain("这是最终回答内容。");
    expect(text).not.toContain("思考过程");
    expect(text).not.toContain("思维链内容");
  });

  it("does not leak UI button labels when falling back to wrapper", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

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
    // @ts-expect-error test global
    globalThis.window = dom.window;
    // @ts-expect-error test global
    globalThis.document = dom.window.document;
    // @ts-expect-error test global
    globalThis.Node = dom.window.Node;
    // @ts-expect-error test global
    globalThis.location = dom.window.location;

    // @ts-expect-error test global
    globalThis.WebClipper = {};
    loadNormalize();
    const collector = loadZaiCollector();

    const wrapper = dom.window.document.querySelector("#message-2");
    const text = collector.__test.extractAssistantText(wrapper);
    expect(text).toContain("Hello answer");
    expect(text).not.toContain("复制");
    expect(text).not.toContain("重新生成");
  });
});
