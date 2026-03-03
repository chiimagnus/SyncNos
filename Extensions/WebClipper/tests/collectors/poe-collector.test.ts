import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ensureCollectorUtils } from "../helpers/collectors-bootstrap";

async function loadNormalize() {
  const normalizeModule = await import("../../src/shared/normalize.ts");
  const normalizeApi = normalizeModule.default || {
    normalizeText: normalizeModule.normalizeText,
    fnv1a32: normalizeModule.fnv1a32,
    makeFallbackMessageKey: normalizeModule.makeFallbackMessageKey,
  };
  if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
    globalThis.WebClipper = {};
  }
  globalThis.WebClipper.normalize = normalizeApi;
  return normalizeApi;
}

async function loadCollectorUtils() {
  return ensureCollectorUtils();
}

async function loadPoeMarkdown() {
  return import("../../src/collectors/poe/poe-markdown.ts");
}

async function loadPoeCollector() {
  const normalizeApi = await loadNormalize();
  const envModule = await import("../../src/collectors/collector-env.ts");
  const poeModule = await import("../../src/collectors/poe/poe-collector.ts");
  const env = envModule.createCollectorEnv({
    // @ts-expect-error test global
    window: globalThis.window,
    // @ts-expect-error test global
    document: globalThis.document,
    // @ts-expect-error test global
    location: globalThis.location,
    normalize: normalizeApi,
  });
  const collector = poeModule.createPoeCollectorDef(env).collector as any;

  // @ts-expect-error test global
  if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") globalThis.WebClipper = {};
  // @ts-expect-error test global
  globalThis.WebClipper.collectors = globalThis.WebClipper.collectors || {};
  // @ts-expect-error test global
  globalThis.WebClipper.collectors.poe = collector;

  return collector;
}

describe("poe-collector", () => {
  it("prefers chat header title text for conversation title", async () => {

    const html = `
      <div class="BaseNavbar_chatTitleItem__GtrXf">
        <div class="ChatHeader_titleRow__M_J3L">
          <p class="ChatHeader_titleText__zXG0d">你好</p>
        </div>
      </div>

      <div class="ChatMessagesView_messageTuple__X">
        <div class="ChatMessage_chatMessage__xkgHx" id="message-1">
          <div class="LeftSideMessageHeader_leftSideMessageHeader__5CfdD">
            <div class="BotHeader_textContainer__kVf_I"><p>Assistant</p></div>
          </div>
          <div class="ChatMessage_messageWrapper__4Ugd6">
            <div class="Message_messageBubbleWrapper__sEq8z">
              <div class="Message_leftSideMessageBubble__VPdk6">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH">
                    <p>reply</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://poe.com/chat/4ogjbuwydndzro1w6g" });
    // @ts-expect-error test global
    globalThis.window = dom.window;
    // @ts-expect-error test global
    globalThis.document = dom.window.document;
    // @ts-expect-error test global
    globalThis.Node = dom.window.Node;
    // @ts-expect-error test global
    globalThis.location = dom.window.location;

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    await loadCollectorUtils();
    await loadPoeMarkdown();
    await loadPoeCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.poe.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.conversation.title).toBe("你好");
  });

  it("filters thinking process and captures markdown for assistant message", async () => {

    const html = `
      <div class="ChatMessagesView_messageTuple__X">
        <div class="ChatMessage_chatMessage__xkgHx" id="message-11">
          <div class="LeftSideMessageHeader_leftSideMessageHeader__5CfdD"></div>
          <div class="ChatMessage_messageWrapper__4Ugd6">
            <div class="Message_messageBubbleWrapper__sEq8z">
              <div class="Message_leftSideMessageBubble__VPdk6">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH">
                    <div class="Markdown_markdownContainer__Tz3HQ">
                      <div class="Prose_prose__7AjXb">
                        <p>Thinking...</p>
                        <blockquote node="[object Object]">
                          <p>this should be ignored</p>
                        </blockquote>
                        <p><strong>Bold</strong> and <em>italic</em> with <a href="https://example.com">link</a>.</p>
                        <ul>
                          <li>Item A</li>
                          <li>Item B</li>
                        </ul>
                        <pre><code class="language-js">console.log(1);\nconsole.log(2);</code></pre>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://poe.com/chat/4ogjbuwydndzro1w6g" });
    // @ts-expect-error test global
    globalThis.window = dom.window;
    // @ts-expect-error test global
    globalThis.document = dom.window.document;
    // @ts-expect-error test global
    globalThis.Node = dom.window.Node;
    // @ts-expect-error test global
    globalThis.location = dom.window.location;

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    await loadCollectorUtils();
    await loadPoeMarkdown();
    await loadPoeCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.poe.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);

    const msg = snap.messages[0];
    expect(msg.contentText).toContain("Bold and italic with link.");
    expect(msg.contentText).not.toContain("Thinking");
    expect(msg.contentText).not.toContain("this should be ignored");

    const md = msg.contentMarkdown || "";
    expect(md).toContain("**Bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("[link](https://example.com)");
    expect(md).toContain("- Item A");
    expect(md).toContain("- Item B");
    expect(md).toContain("```js");
    expect(md).toContain("console.log(1);");
    expect(md).toContain("```");
    expect(md).not.toContain("Thinking...");
    expect(md).not.toContain("this should be ignored");
  });

  it("captures latest poe markdown structure and keeps normal blockquote content", async () => {

    const html = `
      <div class="ChatMessagesView_messageTuple__X">
        <div class="ChatMessage_chatMessage__xkgHx" id="message-12">
          <div class="LeftSideMessageHeader_leftSideMessageHeader__5CfdD"></div>
          <div class="ChatMessage_messageWrapper__4Ugd6">
            <div class="Message_messageBubbleWrapper__sEq8z">
              <div class="Message_leftSideMessageBubble__VPdk6">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH">
                    <div class="Markdown_markdownContainer__Tz3HQ">
                      <div class="Prose_prose__7AjXb Prose_presets_prose__H9VRM Prose_presets_theme-hi-contrast__LQyM9">
                        <p>当然可以！以下是用Markdown格式编写的文本示例：</p>
                        <h1>标题1</h1>
                        <h2>标题2</h2>
                        <p>这是一个段落，里面有一些<strong>加粗的文本</strong>和<em>斜体的文本</em>。</p>
                        <ul>
                          <li>这是一个无序列表
                            <ul>
                              <li>子项1</li>
                              <li>子项2</li>
                            </ul>
                          </li>
                        </ul>
                        <ol>
                          <li>这是一个有序列表</li>
                          <li>项目2</li>
                        </ol>
                        <p><a href="https://www.example.com" target="_blank">这是一个链接</a></p>
                        <blockquote node="[object Object]">
                          <p>这是一个引用。</p>
                        </blockquote>
                        <p>您可以根据需要修改或添加内容！</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://poe.com/chat/4ogjbuwydndzro1w6g" });
    // @ts-expect-error test global
    globalThis.window = dom.window;
    // @ts-expect-error test global
    globalThis.document = dom.window.document;
    // @ts-expect-error test global
    globalThis.Node = dom.window.Node;
    // @ts-expect-error test global
    globalThis.location = dom.window.location;

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    await loadCollectorUtils();
    await loadPoeMarkdown();
    await loadPoeCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.poe.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);

    const md = snap.messages[0].contentMarkdown || "";
    expect(md).toContain("# 标题1");
    expect(md).toContain("## 标题2");
    expect(md).toContain("**加粗的文本**");
    expect(md).toContain("*斜体的文本*");
    expect(md).toContain("- 这是一个无序列表");
    expect(md).toContain("- 子项1");
    expect(md).toContain("- 子项2");
    expect(md).toContain("1. 这是一个有序列表");
    expect(md).toContain("1. 项目2");
    expect(md).toContain("[这是一个链接](https://www.example.com)");
    expect(md).toContain("> 这是一个引用。");
    expect(md).toContain("您可以根据需要修改或添加内容！");
  });

  it("captures user + assistant messages from message tuples (ignores action bar)", async () => {

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
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    await loadCollectorUtils();
    await loadPoeMarkdown();
    await loadPoeCollector();

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

  it("captures messages across date tupleGroupContainer buckets", async () => {

    const html = `
      <div class="ChatMessagesView_chatMessagesView__ROOT">
        <div class="ChatMessagesView_tupleGroupContainer__LSCLm">
          <p class="MessageDate_container__HJE_V">昨天</p>
          <div class="ChatMessagesView_messageTuple__Jh5lQ">
            <div class="ChatMessage_chatMessage__xkgHx" id="message-1">
              <div class="ChatMessage_messageWrapper__4Ugd6 ChatMessage_rightSideMessageWrapper__r0roB">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH"><p>y-user</p></div>
                </div>
              </div>
            </div>
            <div class="ChatMessage_chatMessage__xkgHx" id="message-2">
              <div class="LeftSideMessageHeader_leftSideMessageHeader__5CfdD"></div>
              <div class="ChatMessage_messageWrapper__4Ugd6">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH"><p>y-assistant</p></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="ChatMessagesView_tupleGroupContainer__LSCLm">
          <p class="MessageDate_container__HJE_V">今天</p>
          <div class="ChatMessagesView_messageTuple__Jh5lQ">
            <div class="ChatMessage_chatMessage__xkgHx" id="message-3">
              <div class="ChatMessage_messageWrapper__4Ugd6 ChatMessage_rightSideMessageWrapper__r0roB">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH"><p>t-user</p></div>
                </div>
              </div>
            </div>
            <div class="ChatMessage_chatMessage__xkgHx" id="message-4">
              <div class="LeftSideMessageHeader_leftSideMessageHeader__5CfdD"></div>
              <div class="ChatMessage_messageWrapper__4Ugd6">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH"><p>t-assistant</p></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://poe.com/chat/4ogjbuwydndzro1w6g" });
    // @ts-expect-error test global
    globalThis.window = dom.window;
    // @ts-expect-error test global
    globalThis.document = dom.window.document;
    // @ts-expect-error test global
    globalThis.Node = dom.window.Node;
    // @ts-expect-error test global
    globalThis.location = dom.window.location;

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    await loadCollectorUtils();
    await loadPoeMarkdown();
    await loadPoeCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.poe.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => m.messageKey)).toEqual(["message-1", "message-2", "message-3", "message-4"]);
    expect(snap.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(snap.messages.map((m: any) => m.contentText)).toEqual(["y-user", "y-assistant", "t-user", "t-assistant"]);
  });

  it("auto-loads older poe history on manual prepare before capture", async () => {

    function tupleHtml(startId: number) {
      const userId = startId;
      const aiId = startId + 1;
      return `
        <div class="ChatMessagesView_tupleGroupContainer__LSCLm">
          <div class="ChatMessagesView_messageTuple__Jh5lQ">
            <div class="ChatMessage_chatMessage__xkgHx" id="message-${userId}">
              <div class="ChatMessage_messageWrapper__4Ugd6 ChatMessage_rightSideMessageWrapper__r0roB">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH"><p>u-${userId}</p></div>
                </div>
              </div>
            </div>
            <div class="ChatMessage_chatMessage__xkgHx" id="message-${aiId}">
              <div class="LeftSideMessageHeader_leftSideMessageHeader__5CfdD"></div>
              <div class="ChatMessage_messageWrapper__4Ugd6">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH"><p>a-${aiId}</p></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const html = `
      <div id="scroll-root" style="height: 300px; overflow-y: auto;">
        <div id="list-root">
          ${tupleHtml(5)}
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://poe.com/chat/4ogjbuwydndzro1w6g" });
    // @ts-expect-error test global
    globalThis.window = dom.window;
    // @ts-expect-error test global
    globalThis.document = dom.window.document;
    // @ts-expect-error test global
    globalThis.Node = dom.window.Node;
    // @ts-expect-error test global
    globalThis.location = dom.window.location;

    const scrollRoot = dom.window.document.getElementById("scroll-root");
    const listRoot = dom.window.document.getElementById("list-root");
    expect(scrollRoot).toBeTruthy();
    expect(listRoot).toBeTruthy();

    let loadRound = 0;
    let scrollTopValue = 240;
    Object.defineProperty(scrollRoot, "clientHeight", { configurable: true, get: () => 300 });
    Object.defineProperty(scrollRoot, "scrollHeight", { configurable: true, get: () => 1200 + loadRound * 300 });
    Object.defineProperty(scrollRoot, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value) => {
        scrollTopValue = Number(value) || 0;
        if (scrollTopValue <= 0 && loadRound < 2 && listRoot) {
          loadRound += 1;
          const prepend = loadRound === 1 ? tupleHtml(3) : tupleHtml(1);
          listRoot.innerHTML = `${prepend}${listRoot.innerHTML}`;
          scrollTopValue = loadRound < 2 ? 120 : 0;
        }
      }
    });

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    await loadCollectorUtils();
    await loadPoeMarkdown();
    const collector = await loadPoeCollector();

    await collector.prepareManualCapture({ maxRounds: 10, settleMs: 0, waitForLoadMs: 60, pollMs: 5 });

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.poe.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => m.messageKey)).toEqual([
      "message-1",
      "message-2",
      "message-3",
      "message-4",
      "message-5",
      "message-6"
    ]);
  });

  it("appends image markdown but does not capture bot avatar images", async () => {

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
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    await loadCollectorUtils();
    await loadPoeMarkdown();
    await loadPoeCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.poe.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);

    const md = snap.messages[0].contentMarkdown || "";
    expect(md).toContain("![](https://img.test/attach.png)");
    expect(md).not.toContain("avatar.jpeg");
  });

  it("captures attachment images outside message text container", async () => {

    const html = `
      <div class="ChatMessagesView_messageTuple__X">
        <div class="ChatMessage_chatMessage__xkgHx" id="message-20">
          <div class="ChatMessage_messageWrapper__4Ugd6 ChatMessage_rightSideMessageWrapper__r0roB">
            <div class="Message_messageBubbleWrapper__sEq8z">
              <div class="Message_rightSideMessageBubble__ioa_i">
                <div class="Message_messageTextContainer__w64Sc">
                  <div class="Message_selectableText__SQ8WH">
                    <p><strong>@GLM-5</strong> 这是什么？</p>
                  </div>
                </div>
                <div class="Attachments_attachments__x_H2Q">
                  <img
                    class="FileInfo_interactiveImage__AHKat Attachments_attachment___L7ZA"
                    src="https://pfst.cf2.poecdn.net/base/image/example-image.png?w=1280&h=800"
                    alt="截图.png"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, { url: "https://poe.com/chat/4ogjbuwydndzro1w6g" });
    // @ts-expect-error test global
    globalThis.window = dom.window;
    // @ts-expect-error test global
    globalThis.document = dom.window.document;
    // @ts-expect-error test global
    globalThis.Node = dom.window.Node;
    // @ts-expect-error test global
    globalThis.location = dom.window.location;

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== "object") {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    await loadCollectorUtils();
    await loadPoeMarkdown();
    await loadPoeCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.poe.capture({ manual: true });
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].contentText).toContain("@GLM-5 这是什么？");
    expect(snap.messages[0].contentMarkdown || "").toContain("![](https://pfst.cf2.poecdn.net/base/image/example-image.png?w=1280&h=800)");
  });
});
