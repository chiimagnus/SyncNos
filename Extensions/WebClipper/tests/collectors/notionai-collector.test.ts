import { describe, expect, it } from "vitest";

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
    loadContract();
    loadRegistry();
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
    loadContract();
    loadRegistry();
    loadNotionAiCollector();

    const active = globalThis.WebClipper.collectorsRegistry.pickActive({
      hostname: "www.notion.so",
      pathname: "/0123456789abcdef0123456789abcdef",
      href: "https://www.notion.so/0123456789abcdef0123456789abcdef"
    });
    expect(active && active.id).toBe("notionai");
  });
});

