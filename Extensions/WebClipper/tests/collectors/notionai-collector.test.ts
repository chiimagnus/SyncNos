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
  const modulePath = require.resolve("../../src/collectors/notionai/notionai-collector.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/notionai/notionai-collector.js");
}

function loadNotionAiMarkdown() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/notionai/notionai-markdown.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/notionai/notionai-markdown.js");
}

function loadCollectorUtils() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/collector-utils.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/collector-utils.js");
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

  it("captures user uploaded images (thread attachments) outside text leaf", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const threadId = "30cbe9d6386a807c83e900a970ea41b2";
    const html = `
      <div class="autolayout-col autolayout-fill-width">
        <div style="overflow-x: scroll;">
          <div class="autolayout-row autolayout-fill-width autolayout-center-right">
            <img alt="img" src="/image/attachment%3Ae00be16f-a57a-4995-afac-66d32b83cdb1%3Abd2f9308-fe5b-4edc-8e1e-d12366019f0e.png?table=thread&id=30ebe9d6-386a-80d3-b8fa-00a9ae0cf204&spaceId=6b7be9d6-386a-81db-8d3d-0003c6c8e636&width=1200&cache=v2" />
          </div>
        </div>
        <div class="autolayout-col">
          <div data-agent-chat-user-step-id="30ebe9d6-386a-800c-b8ed-00aa46077426">
            <div data-content-editable-leaf="true">你好</div>
          </div>
        </div>
      </div>
      <div class="autolayout-col autolayout-fill-width">
        <div data-block-id="b1"><div data-content-editable-leaf="true">ok</div></div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: `https://www.notion.so/chiimagnus/Page-0123456789abcdef0123456789abcdef?t=${threadId}`
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
    loadCollectorUtils();
    loadContract();
    loadRegistry();
    loadNotionAiMarkdown();
    const collector = loadNotionAiCollector();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    const userMsg = snap.messages.find((m: any) => m && m.role === "user");
    expect(userMsg).toBeTruthy();
    expect(userMsg.contentMarkdown).toContain("![](https://www.notion.so/image/attachment%3A");
    expect(userMsg.contentMarkdown).toContain("table=thread");
  });

  it("does not capture left sidebar / page blocks outside chat turns", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const threadId = "30cbe9d6386a807c83e900a970ea41b2";
    const html = `
      <div id="sidebar">
        <div data-block-id="sidebar_block_1"><div data-content-editable-leaf="true">Sidebar content</div></div>
      </div>
      <div id="page">
        <div data-block-id="page_block_1"><div data-content-editable-leaf="true">Main page content</div></div>
      </div>
      <div class="autolayout-col autolayout-fill-width" id="tuple_1">
        <div class="autolayout-col">
          <div data-agent-chat-user-step-id="u1">
            <div data-content-editable-leaf="true">User says hi</div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column;">
          <div class="autolayout-col autolayout-fill-width">
            <div data-content-editable-root="true">
              <div data-block-id="a1"><div data-content-editable-leaf="true">Assistant replies ok</div></div>
            </div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: `https://www.notion.so/chiimagnus/Page-0123456789abcdef0123456789abcdef?t=${threadId}`
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
    loadCollectorUtils();
    loadContract();
    loadRegistry();
    loadNotionAiMarkdown();
    const collector = loadNotionAiCollector();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    const texts = snap.messages.map((m: any) => m && m.contentText).join("\n");
    expect(texts).toContain("User says hi");
    expect(texts).toContain("Assistant replies ok");
    expect(texts).not.toContain("Sidebar content");
    expect(texts).not.toContain("Main page content");
  });

  it("pairs assistant replies as the next sibling container after each user turn", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const threadId = "30cbe9d6386a807c83e900a970ea41b2";
    const html = `
      <div id="outside">
        <div data-block-id="page_block_1"><div data-content-editable-leaf="true">Page block (should not capture)</div></div>
      </div>
      <div class="autolayout-col autolayout-fill-width" id="turns_root">
        <div class="autolayout-col">
          <div data-agent-chat-user-step-id="u1"><div data-content-editable-leaf="true">U1</div></div>
        </div>
        <div style="display:flex; flex-direction:column;">
          <div data-content-editable-root="true">
            <div data-block-id="a1"><div data-content-editable-leaf="true">A1</div></div>
          </div>
        </div>
        <div class="autolayout-col">
          <div data-agent-chat-user-step-id="u2"><div data-content-editable-leaf="true">U2</div></div>
        </div>
        <div style="display:flex; flex-direction:column;">
          <div data-content-editable-root="true">
            <div data-block-id="a2"><div data-content-editable-leaf="true">A2</div></div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: `https://www.notion.so/chat?t=${threadId}&wfv=chat`
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
    loadCollectorUtils();
    loadContract();
    loadRegistry();
    loadNotionAiMarkdown();
    const collector = loadNotionAiCollector();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    const pairs = snap.messages.map((m: any) => `${m.role}:${m.contentText}`).join("|");
    expect(pairs).toContain("user:U1");
    expect(pairs).toContain("assistant:A1");
    expect(pairs).toContain("user:U2");
    expect(pairs).toContain("assistant:A2");
    expect(pairs).not.toContain("Page block (should not capture)");
  });

  it("captures nested list and fenced code markdown from assistant blocks", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const threadId = "30cbe9d6386a807c83e900a970ea41b2";
    const html = `
      <div class="autolayout-col autolayout-fill-width" id="turns_root">
        <div class="autolayout-col">
          <div data-agent-chat-user-step-id="u1"><div data-content-editable-leaf="true">U1</div></div>
        </div>
        <div style="display:flex; flex-direction:column;">
          <div data-content-editable-root="true">
            <div data-block-id="a-list-1" class="notion-selectable notion-numbered_list-block">
              <div class="notion-list-item-box-left"><span class="pseudoBefore" style="--pseudoBefore--content: &quot;1.&quot;;">1.</span></div>
              <div data-content-editable-leaf="true">父级条目</div>
              <div data-block-id="a-list-1-1" class="notion-selectable notion-bulleted_list-block">
                <div data-content-editable-leaf="true">子级条目</div>
              </div>
            </div>
            <div data-block-id="a-code-1" class="notion-selectable notion-code-block">
              <div data-content-editable-leaf="true">const value = 1;
console.log(value);</div>
            </div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: `https://www.notion.so/chat?t=${threadId}&wfv=chat`
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
    loadCollectorUtils();
    loadContract();
    loadRegistry();
    loadNotionAiMarkdown();
    const collector = loadNotionAiCollector();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    const assistant = snap.messages.find((m: any) => m && m.role === "assistant");
    expect(assistant).toBeTruthy();
    const md = String(assistant.contentMarkdown || "");
    expect(md).toContain("1. 父级条目");
    expect(md).toContain("  - 子级条目");
    expect(md).toContain("```");
    expect(md).toContain("const value = 1;");
    expect(md).toContain("console.log(value);");
  });
});
