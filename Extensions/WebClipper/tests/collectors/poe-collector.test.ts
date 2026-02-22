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

function loadPoeCollector() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const modulePath = require.resolve("../../src/collectors/poe-collector.js");
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../src/collectors/poe-collector.js");
}

describe("poe-collector", () => {
  it("captures user + assistant messages from message tuples (ignores action bar)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const html = `
      <div class="ChatMessagesView_messageTuple__X">
        <div class="ChatMessage_chatMessage__xkgHx" id="message-1">
          <div class="ChatMessage_messageWrapper__4Ugd6 ChatMessage_rightSideMessageWrapper__r0roB">
            <div class="Message_messageBubbleWrapper__sEq8z">
              <div class="Message_rightSideMessageBubble__ioa_i">
                <button aria-label="更多操作">更多操作</button>
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH">
                    <p>你好</p>
                  </div>
                </div>
                <div class="Message_messageMetadataContainer__nBPq7"><span>23:28</span></div>
              </div>
            </div>
          </div>
        </div>

        <div class="ChatMessage_chatMessage__xkgHx" id="message-2">
          <div class="LeftSideMessageHeader_leftSideMessageHeader__5CfdD">
            <img alt="Assistant avatar" src="https://img.test/avatar.jpeg" />
            <div class="BotHeader_textContainer__kVf_I"><p>Assistant</p></div>
          </div>
          <div class="ChatMessage_messageWrapper__4Ugd6">
            <div class="Message_messageBubbleWrapper__sEq8z">
              <div class="Message_leftSideMessageBubble__VPdk6">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH">
                    <p>你好！有什么我可以帮助你的吗？</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section class="ChatMessageActionBar_actionBar__gyeEs">
          <button aria-label="分享">分享</button>
          <button aria-label="重试">重试</button>
        </section>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://poe.com/Assistant" });
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
    loadPoeCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.poe.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.conversation.source).toBe("poe");
    expect(snap.messages.length).toBe(2);

    expect(snap.messages[0].role).toBe("user");
    expect(snap.messages[0].messageKey).toBe("message-1");
    expect(snap.messages[0].contentText).toContain("你好");
    expect(snap.messages[0].contentText).not.toContain("更多操作");
    expect(snap.messages[0].contentText).not.toContain("23:28");

    expect(snap.messages[1].role).toBe("assistant");
    expect(snap.messages[1].messageKey).toBe("message-2");
    expect(snap.messages[1].contentText).toContain("你好！有什么我可以帮助你的吗？");
    expect(snap.messages[1].contentText).not.toContain("分享");
    expect(snap.messages[1].contentText).not.toContain("重试");
  });

  it("appends image markdown but does not capture bot avatar images", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require("jsdom");

    const html = `
      <div class="ChatMessagesView_messageTuple__X">
        <div class="ChatMessage_chatMessage__xkgHx" id="message-10">
          <div class="LeftSideMessageHeader_leftSideMessageHeader__5CfdD">
            <img alt="Assistant avatar" src="https://img.test/avatar.jpeg" />
          </div>
          <div class="ChatMessage_messageWrapper__4Ugd6">
            <div class="Message_messageBubbleWrapper__sEq8z">
              <div class="Message_leftSideMessageBubble__VPdk6">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH">
                    <p>Answer</p>
                    <img src="https://img.test/attach.png" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://poe.com/Assistant" });
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
    loadPoeCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.poe.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);

    const md = snap.messages[0].contentMarkdown || "";
    expect(md).toContain("![](https://img.test/attach.png)");
    expect(md).not.toContain("avatar.jpeg");
  });
});

