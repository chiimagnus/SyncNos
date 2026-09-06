import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createCollectorsRegistry } from '../../src/collectors/registry.ts';
import { createNotionAiCollectorDef } from '../../src/collectors/notionai/notionai-collector.ts';
import normalizeApi from '@services/shared/normalize.ts';

function setupDom(dom: any) {
  const g = globalThis as any;
  g.window = dom.window;
  g.document = dom.window.document;
  g.Node = dom.window.Node;
  g.location = dom.window.location;
  g.getComputedStyle = dom.window.getComputedStyle;
}

function createCollectorHarness() {
  const g = globalThis as any;
  const env = createCollectorEnv({
    window: g.window,
    document: g.document,
    location: g.location,
    normalize: normalizeApi,
  });
  const def = createNotionAiCollectorDef(env);
  const registry = createCollectorsRegistry();
  registry.register(def);
  return { def, collector: def.collector as any, registry };
}

describe('notionai-collector', () => {
  it('exposes inpageMatches for early UI eligibility', () => {
    const dom = new JSDOM('<body></body>', { url: 'https://app.notion.com/0123456789abcdef0123456789abcdef' });
    setupDom(dom);
    const { collector, registry } = createCollectorHarness();

    expect(typeof collector.__test.inpageMatches).toBe('function');
    expect(
      collector.__test.inpageMatches({ hostname: 'app.notion.com', pathname: '/', href: 'https://app.notion.com/' }),
    ).toBe(true);
    expect(
      collector.__test.inpageMatches({ hostname: 'www.notion.so', pathname: '/', href: 'https://www.notion.so/' }),
    ).toBe(true);
    expect(
      collector.__test.inpageMatches({ hostname: 'example.com', pathname: '/', href: 'https://example.com/' }),
    ).toBe(false);

    const active = registry.pickActive({
      hostname: 'app.notion.com',
      pathname: '/0123456789abcdef0123456789abcdef',
      href: 'https://app.notion.com/0123456789abcdef0123456789abcdef',
    });
    expect(active).toBe(null);
  });

  it('becomes active only when chat turn signals exist', () => {
    const dom = new JSDOM('<body><div data-agent-chat-user-step-id="u1"></div></body>', {
      url: 'https://app.notion.com/0123456789abcdef0123456789abcdef',
    });
    setupDom(dom);
    const { registry } = createCollectorHarness();

    const active = registry.pickActive({
      hostname: 'app.notion.com',
      pathname: '/0123456789abcdef0123456789abcdef',
      href: 'https://app.notion.com/0123456789abcdef0123456789abcdef',
    });
    expect(active && active.id).toBe('notionai');
  });

  it('uses thread id `t` as stable conversationKey and canonical /chat URL', () => {
    const threadId = '30cbe9d6386a807c83e900a970ea41b2';
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
      url: `https://app.notion.com/chiimagnus/Some-Page-0123456789abcdef0123456789abcdef?t=${threadId}`,
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    expect(snap.conversation.conversationKey).toBe(`notionai_t_${threadId}`);
    expect(snap.conversation.url).toBe(`https://app.notion.com/chat?t=${threadId}&wfv=chat`);
  });

  it('uses the first user step id as fallback conversationKey seed when `t` is missing', () => {
    const pageUrl = 'https://app.notion.com/chiimagnus/Page-0123456789abcdef0123456789abcdef';
    const htmlFor = (stepId: string) => `
      <div data-agent-chat-user-step-id="${stepId}">
        <div data-content-editable-leaf="true">你好</div>
      </div>
      <div class="autolayout-col autolayout-fill-width">
        <div data-block-id="b1"><div data-content-editable-leaf="true">Hello</div></div>
      </div>
    `;

    const keys: string[] = [];
    for (const stepId of ['step-a', 'step-b']) {
      const dom = new JSDOM(`<body>${htmlFor(stepId)}</body>`, { url: pageUrl });
      setupDom(dom);
      const { collector } = createCollectorHarness();

      const snap = collector.capture();
      expect(snap).toBeTruthy();
      keys.push(snap.conversation.conversationKey);
    }

    expect(keys[0]).toBe('notionai_0123456789abcdef0123456789abcdef_user_step-a');
    expect(keys[1]).toBe('notionai_0123456789abcdef0123456789abcdef_user_step-b');
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('preserves user->assistant turn ordering even when DOM order differs', () => {
    const html = `
      <div class="turn" id="t1">
        <div class="autolayout-col autolayout-fill-width">
          <div data-block-id="a1"><div data-content-editable-leaf="true">A1</div></div>
        </div>
        <div data-agent-chat-user-step-id="u1">
          <div data-content-editable-leaf="true">U1</div>
        </div>
      </div>

      <div class="turn" id="t2">
        <div class="autolayout-col autolayout-fill-width">
          <div data-block-id="a2"><div data-content-editable-leaf="true">A2</div></div>
        </div>
        <div data-agent-chat-user-step-id="u2">
          <div data-content-editable-leaf="true">U2</div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: 'https://app.notion.com/chiimagnus/Some-Page-0123456789abcdef0123456789abcdef',
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => m && m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(snap.messages.map((m: any) => String(m && m.messageKey))).toEqual([
      'user_u1',
      'assistant_replyTo_u1_a1',
      'user_u2',
      'assistant_replyTo_u2_a2',
    ]);
  });

  it('assigns unique assistant keys when one user turn fans out to multiple assistant wrappers', () => {
    const html = `
      <div id="list">
        <div class="u-item"><div data-agent-chat-user-step-id="u1"><div data-content-editable-leaf="true">U1</div></div></div>
        <div class="a-item"><div data-block-id="a1"><div data-content-editable-leaf="true">A1 first</div></div></div>
        <div class="a-item"><div data-block-id="a2"><div data-content-editable-leaf="true">A1 second</div></div></div>
        <div class="u-item"><div data-agent-chat-user-step-id="u2"><div data-content-editable-leaf="true">U2</div></div></div>
        <div class="a-item"><div data-block-id="a3"><div data-content-editable-leaf="true">A2</div></div></div>
      </div>
      <div role="button" data-testid="agent-send-message-button"></div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: 'https://app.notion.com/chat?t=0123456789abcdef0123456789abcdef&wfv=chat',
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => m && m.role)).toEqual(['user', 'assistant', 'assistant', 'user', 'assistant']);
    expect(snap.messages.map((m: any) => String(m && m.messageKey))).toEqual([
      'user_u1',
      'assistant_replyTo_u1_a1',
      'assistant_replyTo_u1_a2',
      'user_u2',
      'assistant_replyTo_u2_a3',
    ]);
  });

  it('does not drop newly appended turns when chat history is split across multiple list roots', () => {
    const html = `
      <div id="list1">
        <div class="u-item"><div data-agent-chat-user-step-id="u1"><div data-content-editable-leaf="true">U1</div></div></div>
        <div class="a-item"><div data-block-id="a1"><div data-content-editable-leaf="true">A1</div></div></div>
        <div class="u-item"><div data-agent-chat-user-step-id="u2"><div data-content-editable-leaf="true">U2</div></div></div>
        <div class="a-item"><div data-block-id="a2"><div data-content-editable-leaf="true">A2</div></div></div>
      </div>

      <div id="list2">
        <div class="u-item"><div data-agent-chat-user-step-id="u3"><div data-content-editable-leaf="true">U3</div></div></div>
        <div class="a-item"><div data-block-id="a3"><div data-content-editable-leaf="true">A3</div></div></div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: 'https://app.notion.com/chiimagnus/Some-Page-0123456789abcdef0123456789abcdef',
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => m && m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(snap.messages.map((m: any) => String(m && m.contentMarkdown))).toEqual(['U1', 'A1', 'U2', 'A2', 'U3', 'A3']);
  });

  it('captures user-like bubbles without data-agent-chat-user-step-id when assistant still renders', () => {
    const html = `
      <div id="list">
        <div class="u-item">
          <div data-agent-chat-user-step-id="u1"><div data-content-editable-leaf="true">U1</div></div>
        </div>
        <div class="a-item"><div data-block-id="a1"><div data-content-editable-leaf="true">A1</div></div></div>
        <div class="u-item">
          <div class="autolayout-col autolayout-fill-width">
            <div style="padding-top: 6px; padding-bottom: 6px; padding-inline: 14px; border-radius: 16px;">
              <div data-content-editable-leaf="true">U2 missing marker</div>
            </div>
          </div>
        </div>
        <div class="a-item"><div data-block-id="a2"><div data-content-editable-leaf="true">A2</div></div></div>
        <div class="u-item">
          <div data-agent-chat-user-step-id="u3"><div data-content-editable-leaf="true">U3</div></div>
        </div>
        <div class="a-item"><div data-block-id="a3"><div data-content-editable-leaf="true">A3</div></div></div>
        <div role="button" data-testid="agent-send-message-button"></div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: 'https://app.notion.com/chat?t=0123456789abcdef0123456789abcdef&wfv=chat',
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap1 = collector.capture();
    const snap2 = collector.capture();

    expect(snap1).toBeTruthy();
    expect(snap2).toBeTruthy();
    expect(snap1.messages.map((m: any) => m && m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(snap1.messages.map((m: any) => String(m && m.contentMarkdown))).toEqual([
      'U1',
      'A1',
      'U2 missing marker',
      'A2',
      'U3',
      'A3',
    ]);
    expect(String(snap1.messages[2]?.messageKey || '')).toMatch(/^user_user_like_[a-z0-9]+_1$/i);
    expect(String(snap1.messages[3]?.messageKey || '')).toBe(
      `assistant_replyTo_${String(snap1.messages[2]?.messageKey || '').replace(/^user_/, '')}_a2`,
    );
    expect(String(snap2.messages[2]?.messageKey || '')).toBe(String(snap1.messages[2]?.messageKey || ''));
  });

  it('recovers a missing-marker user bubble when chat history is split across multiple small list roots', () => {
    const html = `
      <div id="list1">
        <div class="u-item">
          <div data-agent-chat-user-step-id="u1"><div data-content-editable-leaf="true">U1</div></div>
        </div>
        <div class="a-item"><div data-block-id="a1"><div data-content-editable-leaf="true">A1</div></div></div>
        <div class="u-item">
          <div class="autolayout-col autolayout-fill-width">
            <div style="padding-top: 6px; padding-bottom: 6px; padding-inline: 14px; border-radius: 16px;">
              <div data-content-editable-leaf="true">U2 missing marker</div>
            </div>
          </div>
        </div>
        <div class="a-item"><div data-block-id="a2"><div data-content-editable-leaf="true">A2</div></div></div>
      </div>

      <div id="list2">
        <div class="u-item">
          <div data-agent-chat-user-step-id="u3"><div data-content-editable-leaf="true">U3</div></div>
        </div>
        <div class="a-item"><div data-block-id="a3"><div data-content-editable-leaf="true">A3</div></div></div>
      </div>

      <div role="button" data-testid="agent-send-message-button"></div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: 'https://app.notion.com/chat?t=0123456789abcdef0123456789abcdef&wfv=chat',
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => m && m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(snap.messages.map((m: any) => String(m && m.contentMarkdown))).toEqual([
      'U1',
      'A1',
      'U2 missing marker',
      'A2',
      'U3',
      'A3',
    ]);
  });

  it('does not capture workspace blocks as assistant before the first assistant reply renders', () => {
    const html = `
      <div id="layout">
        <div id="workspace">
          <div data-block-id="p1"><div data-content-editable-leaf="true">Workspace Block 1</div></div>
          <div data-block-id="p2"><div data-content-editable-leaf="true">Workspace Block 2</div></div>
        </div>

        <div id="chat-panel">
          <div data-agent-chat-user-step-id="u1"><div data-content-editable-leaf="true">User message</div></div>
          <div role="button" data-testid="agent-send-message-button"></div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: 'https://app.notion.com/chat?t=0123456789abcdef0123456789abcdef&wfv=chat',
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => m && m.role)).toEqual(['user']);
    expect(snap.messages.map((m: any) => String(m && m.contentMarkdown))).toEqual(['User message']);
  });

  it('does not capture composer draft text as a fallback user turn', () => {
    const html = `
      <div id="layout">
        <div id="chat-panel">
          <div class="u-item">
            <div data-agent-chat-user-step-id="u1"><div data-content-editable-leaf="true">User message</div></div>
          </div>
          <div class="a-item">
            <div data-block-id="a1"><div data-content-editable-leaf="true">Assistant reply</div></div>
          </div>
          <div role="button" data-testid="agent-send-message-button"></div>
        </div>
        <div id="composer">
          <div role="textbox" data-content-editable-leaf="true" contenteditable="true">Draft that must stay out</div>
        </div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: 'https://app.notion.com/chat?t=0123456789abcdef0123456789abcdef&wfv=chat',
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => String(m && m.contentMarkdown))).toEqual(['User message', 'Assistant reply']);
  });

  it('resolves relative notion page mentions to full markdown links', () => {
    const html = `<div data-agent-chat-user-step-id="u1"><div style="padding-top: 6px; padding-bottom: 6px; padding-inline: 14px; border-radius: 16px;"><div data-content-editable-leaf="true">我们来看看这个 <a href="/343be9d6386a806b9a55ea7833f2c0b5?pvs=24" class="notion-page-mention-token notion-text-mention-token notion-focusable-token notion-enable-hover" contenteditable="false" tabindex="0"><span class="notion-page-mention-token__title">全自主鸿蒙智能探地雷达地质建模与隐患检测预警技术研发与应用示范</span></a></div></div></div><div class="autolayout-col autolayout-fill-width"><div data-block-id="a1"><div data-content-editable-leaf="true">assistant</div></div></div>`;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: 'https://app.notion.com/chiimagnus/Some-Page-0123456789abcdef0123456789abcdef',
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap = collector.capture();
    expect(snap).toBeTruthy();

    const user = snap.messages.find((m: any) => m && m.role === 'user');
    expect(user).toBeTruthy();
    expect(user.contentMarkdown).toContain('我们来看看这个');
    expect(user.contentMarkdown).toContain(
      '[全自主鸿蒙智能探地雷达地质建模与隐患检测预警技术研发与应用示范](https://app.notion.com/chiimagnus/343be9d6386a806b9a55ea7833f2c0b5)',
    );
  });

  it('observes the full chat boundary instead of a narrow list root', () => {
    const html = `
      <div id="chat-root">
        <div id="list1">
          <div class="u-item">
            <div data-agent-chat-user-step-id="u1"><div data-content-editable-leaf="true">U1</div></div>
          </div>
          <div class="a-item"><div data-block-id="a1"><div data-content-editable-leaf="true">A1</div></div></div>
        </div>
        <div id="list2">
          <div class="u-item">
            <div data-agent-chat-user-step-id="u2"><div data-content-editable-leaf="true">U2</div></div>
          </div>
          <div class="a-item"><div data-block-id="a2"><div data-content-editable-leaf="true">A2</div></div></div>
        </div>
        <div role="button" data-testid="agent-send-message-button"></div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: 'https://app.notion.com/chat?t=0123456789abcdef0123456789abcdef&wfv=chat',
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const root = collector.getRoot();
    expect((root as Element | null)?.id).toBe('chat-root');
  });

  it('captures the latest user turn even when no assistant reply has rendered yet', () => {
    const html = `
      <div id="chat-root">
        <div id="list1">
          <div class="u-item">
            <div data-agent-chat-user-step-id="u1"><div data-content-editable-leaf="true">U1</div></div>
          </div>
          <div class="a-item"><div data-block-id="a1"><div data-content-editable-leaf="true">A1</div></div></div>
          <div class="u-item">
            <div data-agent-chat-user-step-id="u2"><div data-content-editable-leaf="true">U2</div></div>
          </div>
          <div class="a-item"><div data-block-id="a2"><div data-content-editable-leaf="true">A2</div></div></div>
        </div>
        <div id="list2">
          <div class="u-item">
            <div data-agent-chat-user-step-id="u3"><div data-content-editable-leaf="true">U3 latest no reply yet</div></div>
          </div>
        </div>
        <div role="button" data-testid="agent-send-message-button"></div>
      </div>
    `;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: 'https://app.notion.com/chat?t=0123456789abcdef0123456789abcdef&wfv=chat',
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => m && m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(snap.messages.map((m: any) => String(m && m.contentMarkdown))).toEqual([
      'U1',
      'A1',
      'U2',
      'A2',
      'U3 latest no reply yet',
    ]);
    expect(String(snap.messages[4]?.messageKey || '')).toBe('user_u3');
  });
});
