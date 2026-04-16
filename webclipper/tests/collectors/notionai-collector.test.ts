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
    const dom = new JSDOM('<body></body>', { url: 'https://www.notion.so/0123456789abcdef0123456789abcdef' });
    setupDom(dom);
    const { collector, registry } = createCollectorHarness();

    expect(typeof collector.__test.inpageMatches).toBe('function');
    expect(
      collector.__test.inpageMatches({ hostname: 'www.notion.so', pathname: '/', href: 'https://www.notion.so/' }),
    ).toBe(true);
    expect(
      collector.__test.inpageMatches({ hostname: 'example.com', pathname: '/', href: 'https://example.com/' }),
    ).toBe(false);

    const active = registry.pickActive({
      hostname: 'www.notion.so',
      pathname: '/0123456789abcdef0123456789abcdef',
      href: 'https://www.notion.so/0123456789abcdef0123456789abcdef',
    });
    expect(active).toBe(null);
  });

  it('becomes active only when chat turn signals exist', () => {
    const dom = new JSDOM('<body><div data-agent-chat-user-step-id="u1"></div></body>', {
      url: 'https://www.notion.so/0123456789abcdef0123456789abcdef',
    });
    setupDom(dom);
    const { registry } = createCollectorHarness();

    const active = registry.pickActive({
      hostname: 'www.notion.so',
      pathname: '/0123456789abcdef0123456789abcdef',
      href: 'https://www.notion.so/0123456789abcdef0123456789abcdef',
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
      url: `https://www.notion.so/chiimagnus/Some-Page-0123456789abcdef0123456789abcdef?t=${threadId}`,
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap = collector.capture();
    expect(snap).toBeTruthy();
    expect(snap.conversation.conversationKey).toBe(`notionai_t_${threadId}`);
    expect(snap.conversation.url).toBe(`https://www.notion.so/chat?t=${threadId}&wfv=chat`);
  });

  it('uses the first user step id as fallback conversationKey seed when `t` is missing', () => {
    const pageUrl = 'https://www.notion.so/chiimagnus/Page-0123456789abcdef0123456789abcdef';
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

  it('resolves relative notion page mentions to full markdown links', () => {
    const html = `<div data-agent-chat-user-step-id="u1"><div style="padding-top: 6px; padding-bottom: 6px; padding-inline: 14px; border-radius: 16px;"><div data-content-editable-leaf="true">我们来看看这个 <a href="/343be9d6386a806b9a55ea7833f2c0b5?pvs=24" class="notion-page-mention-token notion-text-mention-token notion-focusable-token notion-enable-hover" contenteditable="false" tabindex="0"><span class="notion-page-mention-token__title">全自主鸿蒙智能探地雷达地质建模与隐患检测预警技术研发与应用示范</span></a></div></div></div><div class="autolayout-col autolayout-fill-width"><div data-block-id="a1"><div data-content-editable-leaf="true">assistant</div></div></div>`;

    const dom = new JSDOM(`<body>${html}</body>`, {
      url: 'https://www.notion.so/chiimagnus/Some-Page-0123456789abcdef0123456789abcdef',
    });
    setupDom(dom);
    const { collector } = createCollectorHarness();

    const snap = collector.capture();
    expect(snap).toBeTruthy();

    const user = snap.messages.find((m: any) => m && m.role === 'user');
    expect(user).toBeTruthy();
    expect(user.contentText).toContain('我们来看看这个');
    expect(user.contentMarkdown).toContain(
      '[全自主鸿蒙智能探地雷达地质建模与隐患检测预警技术研发与应用示范](https://www.notion.so/chiimagnus/343be9d6386a806b9a55ea7833f2c0b5)',
    );
  });
});
