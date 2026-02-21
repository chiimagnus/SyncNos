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

function loadCollector(relPath: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve(relPath);
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(relPath);
}

describe("collectors images (smoke)", () => {
  it("chatgpt collector appends image markdown", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const dom = new JSDOM(
      `<body>
        <main>
          <div id="m_user" data-testid="conversation-turn" data-message-author-role="user">
            <div class="whitespace-pre-wrap">hello</div>
            <img src="https://img.test/u.png" />
          </div>
          <div id="m_ai" data-testid="conversation-turn" data-message-author-role="assistant">
            <div class="markdown">
              <p>hi</p>
              <img srcset="https://img.test/a1.png 1x, https://img.test/a2.png 2x" />
            </div>
          </div>
        </main>
      </body>`,
      { url: "https://chatgpt.com/c/conv1" }
    );

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
    loadCollectorUtils();
    loadCollector("../../src/collectors/chatgpt-collector.js");

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.chatgpt.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    expect(snap.messages[0].contentMarkdown).toContain("![](https://img.test/u.png)");
    expect(snap.messages[1].contentMarkdown).toContain("![](https://img.test/a2.png)");
  });

  it("claude collector appends image markdown", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const dom = new JSDOM(
      `<body>
        <main>
          <div data-test-render-count="1">
            <div data-testid="user-message">
              <p>user text</p>
              <img src="https://img.test/c-user.png" />
            </div>
            <div class="font-claude-response">
              <div>assistant text</div>
              <img src="https://img.test/c-ai.png" />
            </div>
          </div>
        </main>
      </body>`,
      { url: "https://claude.ai/chat/conv1" }
    );

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
    loadCollectorUtils();
    loadCollector("../../src/collectors/claude-collector.js");

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.claude.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    expect(snap.messages[0].contentMarkdown).toContain("![](https://img.test/c-user.png)");
    expect(snap.messages[1].contentMarkdown).toContain("![](https://img.test/c-ai.png)");
  });

  it("z.ai collector appends image markdown", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const dom = new JSDOM(
      `<body>
        <main>
          <div id="message-1" class="user-message">
            <div class="whitespace-pre-wrap">
              user
              <img src="https://img.test/z-user.png" />
            </div>
          </div>
          <div id="message-2">
            <div class="chat-assistant">
              <div id="response-content-container">
                <div class="markdown-prose">
                  <p>assistant</p>
                  <img src="https://img.test/z-ai.png" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </body>`,
      { url: "https://chat.z.ai/c/conv1" }
    );

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
    loadCollectorUtils();
    loadCollector("../../src/collectors/zai/zai-markdown.js");
    loadCollector("../../src/collectors/zai/zai-collector.js");

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.zai.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    expect(snap.messages[0].contentMarkdown).toContain("![](https://img.test/z-user.png)");
    expect(snap.messages[1].contentMarkdown).toContain("![](https://img.test/z-ai.png)");
  });
});
