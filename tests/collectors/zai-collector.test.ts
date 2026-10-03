import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createZaiCollectorDef } from '../../src/collectors/zai/zai-collector.ts';
import normalizeApi from '@services/shared/normalize.ts';

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

async function capturePrepared(collector: any, options: Record<string, unknown> = {}) {
  const preparedCapture = await collector.prepareManualCapture({
    maxSteps: 8,
    stableSamples: 1,
    pollMs: 0,
    stepTimeoutMs: 20,
    boundaryTimeoutMs: 20,
    sleep: async () => {},
    ...options,
  });
  return collector.capture({ manual: true, preparedCapture });
}

function conversationBody(messages: string, extra = '') {
  return `<body><div id="messages-container">${messages}</div>${extra}</body>`;
}

describe('zai-collector', () => {
  it('preserves current readonly CodeMirror code blocks without toolbar labels', async () => {
    const code = `const html = '<div data-x="a&b">中文 😀</div>';\n\nconsole.log(html);`;
    const dom = new JSDOM(
      conversationBody(`<div id="message-code"><div class="chat-assistant"><div id="response-content-container">
        <p>Code:</p><div class="relative">
          <div class="absolute text-xs font-medium">ts</div>
          <div class="sticky"><button>Copy</button></div>
          <div class="language-ts"><div class="cm-editor"><div class="cm-content" contenteditable="false" data-language="typescript">
            <div class="cm-line">const html = '&lt;div data-x="a&amp;b"&gt;中文 😀&lt;/div&gt;';</div>
            <div class="cm-line"><br></div><div class="cm-line">console.log(html);</div>
          </div></div></div>
        </div><p>End</p>
      </div></div></div>`),
      { url: 'https://chat.z.ai/c/conv-code' },
    );
    setupDom(dom);
    const snapshot = await createCollector().capture();
    expect(snapshot.messages[0].contentMarkdown).toContain('```ts\n' + code + '\n```');
    expect(snapshot.messages[0].contentMarkdown).not.toContain('Copy');
    expect(snapshot.messages[0].contentMarkdown).not.toContain('\n\nts\n');
  });

  it('captures user uploaded images from attachment card', async () => {
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
          <div class="relative w-full"><div class="whitespace-pre-wrap">这是什么？</div></div>
        </div>
      </div>
    `;

    const dom = new JSDOM(conversationBody(html), { url: 'https://chat.z.ai/c/conv-img1' });
    setupDom(dom);
    const snap = (await capturePrepared(createCollector())) as any;
    expect(snap).toBeTruthy();
    expect(snap.captureMeta.completeness).toBe('complete');
    expect(snap.messages).toHaveLength(1);
    expect(snap.messages[0].role).toBe('user');
    expect(snap.messages[0].contentMarkdown).toContain('这是什么？');
    expect(snap.messages[0].contentMarkdown).toContain('![](https://z-cdn-media.chatglm.cn/files/');
  });

  it('uses the selected z.ai history title instead of the site slogan', async () => {
    const html = `
      <button data-selected="true"><div>真实 z.ai 标题</div></button>
      <div id="message-title" class="user-message">
        <div class="chat-user"><div class="whitespace-pre-wrap">标题测试正文</div></div>
      </div>
    `;
    const dom = new JSDOM(conversationBody(html), { url: 'https://chat.z.ai/c/conv-title' });
    dom.window.document.title = 'Z.ai - Advanced AI Chatbot & Agent powered by GLM-5.3-Flash';
    setupDom(dom);

    const snap = (await capturePrepared(createCollector())) as any;
    expect(snap.conversation.title).toBe('真实 z.ai 标题');
  });

  it('ignores thinking-chain-container content', () => {
    const html = `
      <div id="message-1">
        <div class="chat-assistant">
          <div id="response-content-container">
            <div class="markdown-prose">
              <div data-direct="false" class="w-full thinking-chain-container">
                <button><span>思考过程</span></button>
              </div>
              <div class="thinking-block"><blockquote><p>这里是思维链内容，应该被忽略。</p></blockquote></div>
              <p>这是最终回答内容。</p>
            </div>
          </div>
        </div>
      </div>
    `;
    const dom = new JSDOM(conversationBody(html), { url: 'https://chat.z.ai/c/conv1' });
    setupDom(dom);
    const collector = createCollector();
    const text = collector.__test.extractAssistantText(dom.window.document.querySelector('#message-1'));
    expect(text).toContain('这是最终回答内容。');
    expect(text).not.toContain('思考过程');
    expect(text).not.toContain('思维链内容');
  });

  it('extracts assistant markdown from rendered HTML', () => {
    const html = `
      <div id="message-3">
        <div class="chat-assistant">
          <div id="response-content-container">
            <div class="markdown-prose">
              <p><strong>Bold</strong> and <em>italic</em> with <a href="https://example.com">link</a> and <code>x = 1</code>.</p>
              <ul><li>Item A</li><li>Item B</li></ul>
              <pre><code class="language-js">console.log(1);\nconsole.log(2);</code></pre>
            </div>
          </div>
        </div>
      </div>
    `;
    const dom = new JSDOM(conversationBody(html), { url: 'https://chat.z.ai/c/conv3' });
    setupDom(dom);
    const collector = createCollector();
    const md = collector.__test.extractAssistantMarkdown(dom.window.document.querySelector('#message-3'));
    expect(md).toContain('**Bold**');
    expect(md).toContain('*italic*');
    expect(md).toContain('[link](https://example.com)');
    expect(md).toContain('`x = 1`');
    expect(md).toContain('- Item A');
    expect(md).toContain('- Item B');
    expect(md).toContain('```js');
    expect(md).toContain('console.log(1);');
  });

  it('preserves rich markdown structure used by current z.ai responses', () => {
    const html = `
      <div id="message-rich">
        <div class="chat-assistant markdown-prose">
          <div id="response-content-container">
            <h4>Deep heading</h4>
            <ul><li>Parent<ul><li>Child</li></ul></li></ul>
            <table>
              <thead><tr><th>Name</th><th>Value</th></tr></thead>
              <tbody><tr><td>A</td><td>1</td></tr></tbody>
            </table>
            <p>Inline <span class="katex"><annotation encoding="application/x-tex">x^2</annotation></span> formula.</p>
            <img src="https://example.com/result.png" alt="result" />
          </div>
        </div>
      </div>
    `;
    const dom = new JSDOM(conversationBody(html), { url: 'https://chat.z.ai/c/conv-rich' });
    setupDom(dom);
    const collector = createCollector();
    const md = collector.__test.extractAssistantMarkdown(dom.window.document.querySelector('#message-rich'));
    expect(md).toContain('#### Deep heading');
    expect(md).toContain('- Parent\n  - Child');
    expect(md).toContain('| Name | Value |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| A | 1 |');
    expect(md).toContain('$x^2$');
    expect(md).toContain('![](https://example.com/result.png)');
  });

  it('captures current z.ai file cards and videos as user attachments', async () => {
    const html = `
      <div id="message-files" class="user-message">
        <div class="chat-user markdown-prose">
          <div class="flex overflow-x-auto flex-col flex-wrap gap-1 justify-end mt-2.5 mb-1 w-full">
            <button type="button">
              <div><img src="../icons/pdf.svg" alt="PDF" /></div>
              <div><div class="text-sm leading-5 text-text-primary truncate">paper.pdf</div></div>
            </button>
            <video src="https://example.com/demo.mp4"></video>
          </div>
          <div class="relative w-full"><div class="whitespace-pre-wrap">请总结附件</div></div>
        </div>
      </div>
    `;
    const dom = new JSDOM(conversationBody(html), { url: 'https://chat.z.ai/c/conv-files' });
    setupDom(dom);
    const snap = (await capturePrepared(createCollector())) as any;
    expect(snap.messages).toHaveLength(1);
    expect(snap.messages[0].contentMarkdown).toContain('Attachment: paper.pdf');
    expect(snap.messages[0].contentMarkdown).toContain('[Video attachment](https://example.com/demo.mp4)');
    expect(snap.messages[0].contentMarkdown).toContain('请总结附件');
  });

  it('does not prepare a capture while the user is editing a message', async () => {
    const html = `
      <div id="message-editing" class="user-message">
        <div class="chat-user"><div class="whitespace-pre-wrap">旧内容</div></div>
        <textarea id="message-edit-editing">正在编辑</textarea>
      </div>
    `;
    const dom = new JSDOM(conversationBody(html), { url: 'https://chat.z.ai/c/conv-edit' });
    setupDom(dom);
    expect(await createCollector().prepareManualCapture({ manual: true })).toBeNull();
  });

  it('keeps an unfinished tail assistant partial while z.ai shows the stop control', async () => {
    const html = `
      <div id="message-user" class="user-message">
        <div class="chat-user"><div class="whitespace-pre-wrap">question</div></div>
      </div>
      <div id="message-assistant">
        <div class="chat-assistant"><div id="response-content-container"><p>partial answer</p></div></div>
      </div>
    `;
    const dom = new JSDOM(conversationBody(html, '<textarea id="chat-input"></textarea>'), {
      url: 'https://chat.z.ai/c/conv-stream',
    });
    setupDom(dom);
    const collector = createCollector();
    let clock = 0;
    const snap = (await capturePrepared(collector, {
      stepTimeoutMs: 2,
      boundaryTimeoutMs: 2,
      totalDeadlineMs: 20,
      now: () => clock,
      sleep: async () => {
        clock += 2;
      },
    })) as any;
    expect(snap.captureMeta.completeness).toBe('partial');
    expect(snap.messages).toHaveLength(1);
    expect(snap.messages[0]).toMatchObject({ messageKey: 'message-user', role: 'user' });
  });

  it('loads older batches until the current z.ai top sentinel disappears', async () => {
    const html = `
      <div id="older-loader" class="animate-pulse">Loading...</div>
      <div id="message-new" class="user-message">
        <div class="chat-user"><div class="whitespace-pre-wrap">new</div></div>
      </div>
    `;
    const dom = new JSDOM(conversationBody(html), { url: 'https://chat.z.ai/c/conv-batched' });
    setupDom(dom);
    const collector = createCollector();
    let loaded = false;
    const snap = (await capturePrepared(collector, {
      sleep: async () => {
        if (loaded) return;
        loaded = true;
        dom.window.document.getElementById('older-loader')?.remove();
        const older = dom.window.document.createElement('div');
        older.id = 'message-old';
        older.className = 'user-message';
        older.innerHTML = '<div class="chat-user"><div class="whitespace-pre-wrap">old</div></div>';
        dom.window.document.getElementById('messages-container')?.prepend(older);
      },
    })) as any;

    expect(snap.captureMeta.completeness).toBe('complete');
    expect(snap.messages.map((message: any) => message.messageKey)).toEqual(['message-old', 'message-new']);
    expect(snap.messages.map((message: any) => message.contentMarkdown)).toEqual(['old', 'new']);
  });

  it('auto-captures partial windows and requires preparation only for manual history', async () => {
    const html = `
      <div id="message-1" class="user-message">
        <div class="chat-user"><div class="whitespace-pre-wrap">hello</div></div>
      </div>
    `;
    const dom = new JSDOM(conversationBody(html), { url: 'https://chat.z.ai/c/conv-manual' });
    setupDom(dom);
    const collector = createCollector();
    const prepared = await collector.prepareManualCapture({ stableSamples: 1, pollMs: 0, sleep: async () => {} });
    expect((await collector.capture()).captureMeta.completeness).toBe('partial');
    expect(await collector.capture({ manual: true })).toBeNull();
    expect(await collector.capture({ manual: true, preparedCapture: prepared })).toBeTruthy();

    const home = new JSDOM('<body><div id="messages-container"></div></body>', { url: 'https://chat.z.ai/' });
    setupDom(home);
    expect(createCollector().isCaptureAvailable()).toBe(false);
  });

  it('does not leak UI button labels when falling back to wrapper', () => {
    const html = `
      <div id="message-2">
        <div class="chat-assistant">
          <div class="markdown-prose">
            <div data-direct="false" class="thinking-chain-container"><button><span>思考过程</span></button></div>
            <div class="thinking-block"><blockquote><p>should be ignored</p></blockquote></div>
            <p>Hello answer</p>
          </div>
          <div class="buttons"><button>复制</button><button>重新生成</button></div>
        </div>
      </div>
    `;
    const dom = new JSDOM(conversationBody(html), { url: 'https://chat.z.ai/c/conv2' });
    setupDom(dom);
    const text = createCollector().__test.extractAssistantText(dom.window.document.querySelector('#message-2'));
    expect(text).toContain('Hello answer');
    expect(text).not.toContain('复制');
    expect(text).not.toContain('重新生成');
  });
});
