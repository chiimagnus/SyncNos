import { describe, expect, it } from "vitest";

function loadNormalize() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/shared/normalize.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/shared/normalize.js");
}

function loadRegistry() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/registry.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/registry.js");
}

function loadContract() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/collector-contract.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/collector-contract.js");
}

function loadNotionAiCollector() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/notionai-collector.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/notionai-collector.js");
}

function loadNotionAiMarkdown() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/notionai/notionai-markdown.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/notionai/notionai-markdown.js");
}

describe("notionai-collector", () => {
  it("exposes inpageMatches for early UI eligibility", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const dom = new JSDOM("<body></body>", { url: "https://www.notion.so/0123456789abcdef0123456789abcdef" });
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
    loadContract();
    loadRegistry();
    loadNotionAiMarkdown();
    const collector = loadNotionAiCollector();

    expect(typeof collector.__test.inpageMatches).toBe("function");
    expect(collector.__test.inpageMatches({ hostname: "www.notion.so", pathname: "/", href: "https://www.notion.so/" })).toBe(true);
    expect(collector.__test.inpageMatches({ hostname: "example.com", pathname: "/", href: "https://example.com/" })).toBe(false);

    const active = globalThis.WebClipper.collectorsRegistry.pickActive({
      hostname: "www.notion.so",
      pathname: "/0123456789abcdef0123456789abcdef",
      href: "https://www.notion.so/0123456789abcdef0123456789abcdef"
    });
    expect(active).toBe(null);
  });

  it("becomes active only when chat turn signals exist", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const html = `<div data-agent-chat-user-step-id="u1"></div>`;
    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://www.notion.so/0123456789abcdef0123456789abcdef" });
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
    loadContract();
    loadRegistry();
    loadNotionAiMarkdown();
    loadNotionAiCollector();

    const active = globalThis.WebClipper.collectorsRegistry.pickActive({
      hostname: "www.notion.so",
      pathname: "/0123456789abcdef0123456789abcdef",
      href: "https://www.notion.so/0123456789abcdef0123456789abcdef"
    });
    expect(active && active.id).toBe("notionai");
  });

  it("uses thread id `t` as stable conversationKey and canonical /chat URL", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const threadId = "30cbe9d6386a807c83e900a970ea41b2";
    const html = `
      <div data-agent-chat-user-step-id="u1">
        <div data-content-editable-leaf="true">你好</div>
      </div>
      <div class="autolayout-col autolayout-fill-width">
        <div data-block-id="b1">
          <div data-content-editable-leaf="true">Hello</div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: `https://www.notion.so/chiimagnus/Some-Page-0123456789abcdef0123456789abcdef?t=${threadId}`
    });
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
    loadContract();
    loadRegistry();
    loadNotionAiMarkdown();
    const collector = loadNotionAiCollector();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    expect(snap.conversation.conversationKey).toBe(`notionai_t_${threadId}`);
    expect(snap.conversation.url).toBe(`https://www.notion.so/chat?t=${threadId}&wfv=chat`);
  });

  it("keeps notionai conversationKey stable across different page paths when `t` matches", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const threadId = "30cbe9d6386a807c83e900a970ea41b2";
    const html = `
      <div data-agent-chat-user-step-id="u1">
        <div data-content-editable-leaf="true">hi</div>
      </div>
      <div class="autolayout-col autolayout-fill-width">
        <div data-block-id="b1"><div>ok</div></div>
      </div>
    `;

    const urls = [
      `https://www.notion.so/chiimagnus/Page-A-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?t=${threadId}`,
      `https://www.notion.so/chiimagnus/Page-B-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?t=${threadId}`
    ];

    const keys: string[] = [];
    for (const url of urls) {
      const dom = new JSDOM(`<body>${html}</body>`, { url });
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
      loadContract();
      loadRegistry();
      loadNotionAiMarkdown();
      const collector = loadNotionAiCollector();

      const snap = collector.capture();
      keys.push(snap.conversation.conversationKey);
    }

    expect(keys[0]).toBe(`notionai_t_${threadId}`);
    expect(keys[1]).toBe(`notionai_t_${threadId}`);
  });
});
