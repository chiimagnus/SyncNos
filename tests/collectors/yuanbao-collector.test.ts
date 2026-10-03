import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createYuanbaoCollectorDef } from '../../src/collectors/yuanbao/yuanbao-collector.ts';

function setupYuanbaoDom(messages: string, url = 'https://yuanbao.tencent.com/chat/conv001') {
  const dom = new JSDOM(
    `<body>
      <div class="agent-chat__list__content-wrapper" style="overflow-y:auto">
        <main class="agent-chat__list__content">${messages}</main>
      </div>
      <div class="ql-editor ql-blank" contenteditable="true"></div>
    </body>`,
    { url, pretendToBeVisual: true },
  );
  const scroll = dom.window.document.querySelector('.agent-chat__list__content-wrapper') as HTMLElement;
  (scroll as any).scrollTo = ({ top = 0 }: { top?: number }) => {
    scroll.scrollTop = top;
    scroll.dispatchEvent(new dom.window.Event('scroll'));
  };
  (dom.window as any).scrollTo = vi.fn();
  return dom;
}

function item(index: number, speaker: 'human' | 'ai', content: string, attrs: Record<string, string> = {}) {
  const extra = Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');
  return `<div class="agent-chat__list__item agent-chat__list__item--${speaker === 'human' ? 'human' : 'ai'}"
    data-conv-idx="${index}" data-conv-speaker="${speaker}" ${extra}>${content}</div>`;
}

function createDef(dom: JSDOM) {
  return createYuanbaoCollectorDef(
    createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    }),
  ) as any;
}

async function capturePrepared(def: any, options: Record<string, unknown> = {}) {
  let clock = 0;
  const preparedCapture = await def.collector.prepareManualCapture({
    maxRounds: 2,
    stableRounds: 1,
    waitForLoadMs: 2,
    pollMs: 1,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += Math.max(1, ms);
    },
    ...options,
  });
  return preparedCapture ? def.collector.capture({ manual: true, preparedCapture }) : null;
}

describe('yuanbao-collector', () => {
  it('supports the current one-segment route, stable data-conv keys, and final assistant markdown only', async () => {
    const dom = setupYuanbaoDom(
      item(0, 'human', '<div class="agent-chat__bubble"><div class="hyc-content-text">你好</div></div>') +
        item(
          1,
          'ai',
          `<div class="hyc-component-reasoner__text">内部思考不应保存</div>
           <div class="agent-chat__speech-text">
             <div class="hyc-common-markdown hyc-common-markdown-style">
               <h1>主标题</h1>
               <div class="ybc-p"><strong>粗体</strong> 与 <em>斜体</em>，以及 <code class="hyc-common-markdown__code__inline">inline()</code></div>
               <ol class="ybc-ol-component"><li class="ybc-li-component ybc-li-component_ol"><span class="ybc-li-component_content"><div class="ybc-p">父级条目</div><ul class="ybc-ul-component"><li class="ybc-li-component ybc-li-component_ul"><span class="ybc-li-component_content"><div class="ybc-p">子级条目</div></span></li></ul></span></li></ol>
               <blockquote><div class="ybc-p">引用内容</div></blockquote>
               <table><thead><tr><th><div class="ybc-p">列1</div></th><th><div class="ybc-p">列2</div></th></tr></thead><tbody><tr><td><div class="ybc-p">A</div></td><td><div class="ybc-p">B</div></td></tr></tbody></table>
               <a href="https://example.com/wiki">百科链接</a>
               <pre class="ybc-pre-component"><div class="hyc-common-markdown__code"><div class="hyc-common-markdown__code__hd"><div class="hyc-common-markdown__code__hd__l">python</div><div class="hyc-common-markdown__code__option">复制</div></div><pre><code class="language-python">print("yuanbao")</code></pre></div></pre>
             </div>
           </div>`,
        ),
    );

    const snapshot = (await capturePrepared(createDef(dom))) as any;
    expect(snapshot).toBeTruthy();
    expect(snapshot.conversation.conversationKey).toBe('conv001');
    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'yuanbao_0_user',
      'yuanbao_1_assistant',
    ]);
    const assistant = snapshot.messages[1].contentMarkdown;
    expect(assistant).toContain('# 主标题');
    expect(assistant).toContain('**粗体**');
    expect(assistant).toContain('*斜体*');
    expect(assistant).toContain('`inline()`');
    expect(assistant).toContain('1. 父级条目');
    expect(assistant).toContain('  - 子级条目');
    expect(assistant).toContain('> 引用内容');
    expect(assistant).toContain('| 列1 | 列2 |');
    expect(assistant).toContain('[百科链接](https://example.com/wiki)');
    expect(assistant).toContain('```python');
    expect(assistant).toContain('print("yuanbao")');
    expect(assistant).not.toContain('内部思考');
    expect(assistant).not.toContain('复制');
  });

  it('captures multimodal images and file names without treating file icons as content images', async () => {
    const dom = setupYuanbaoDom(
      item(
        0,
        'human',
        `<div class="agent-chat__bubble">
          <div class="hyc-content-text">请总结附件</div>
          <div class="hyc-content-file"><img src="https://static.yuanbao.tencent.com/file-icon.svg"><div class="hyc-content-file__info__name">paper.pdf</div></div>
          <div class="hyc-content-img"><img src="https://yuanbao.tencent.com/api/resource/download?resourceId=image001"></div>
          <div class="hyc-content-text">请总结附件</div>
        </div>`,
      ),
    );
    const snapshot = (await capturePrepared(createDef(dom))) as any;
    const markdown = snapshot.messages[0].contentMarkdown;

    expect(snapshot.messages[0].messageKey).toBe('yuanbao_0_user');
    expect(markdown).toContain('Attachment: paper.pdf');
    expect(markdown).toContain('请总结附件');
    expect(markdown.match(/请总结附件/g)).toHaveLength(1);
    expect(markdown).toContain('![](https://yuanbao.tencent.com/api/resource/download?resourceId=image001)');
    expect(markdown).not.toContain('file-icon.svg');
  });

  it('keeps outputting assistant messages unresolved instead of saving partial final text', async () => {
    const dom = setupYuanbaoDom(
      item(0, 'human', '<div class="hyc-content-text">question</div>') +
        item(
          1,
          'ai',
          '<div class="agent-chat__speech-text"><div class="hyc-common-markdown"><p>partial answer</p></div></div>',
          { 'data-conv-outputting': 'true' },
        ),
    );
    const snapshot = (await capturePrepared(createDef(dom))) as any;

    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.captureMeta.reasons).toContain('unresolved_turn');
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0]).toMatchObject({ messageKey: 'yuanbao_0_user', role: 'user' });
  });

  it('harvests older lazy-loaded history but remains partial-safe because chat.hasMore is not exposed in DOM', async () => {
    const dom = setupYuanbaoDom(item(10, 'human', '<div class="hyc-content-text">new</div>'));
    const def = createDef(dom);
    let clock = 0;
    let loaded = false;
    const snapshot = (await capturePrepared(def, {
      maxRounds: 3,
      stableRounds: 1,
      waitForLoadMs: 4,
      pollMs: 1,
      now: () => clock,
      sleep: async (ms: number) => {
        clock += Math.max(1, ms);
        if (loaded) return;
        loaded = true;
        const older = dom.window.document.createElement('div');
        older.className = 'agent-chat__list__item agent-chat__list__item--human';
        older.setAttribute('data-conv-idx', '8');
        older.setAttribute('data-conv-speaker', 'human');
        older.innerHTML = '<div class="hyc-content-text">old</div>';
        dom.window.document.querySelector('.agent-chat__list__content')?.prepend(older);
      },
    })) as any;

    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.captureMeta.reasons).toContain('top_not_reached');
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual(['yuanbao_8_user', 'yuanbao_10_user']);
  });

  it('preserves display formulas instead of converting them to code fences', async () => {
    const dom = setupYuanbaoDom(
      item(
        1,
        'ai',
        `<div class="agent-chat__speech-text"><div class="hyc-common-markdown hyc-common-markdown-style">
          <div class="ybc-p">公式：</div>
          <pre class="ybc-pre-component"><span class="ybc-markdown-katex"><span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">ignored</span></span></span></span></pre>
        </div></div>`,
      ),
    );
    const snapshot = (await capturePrepared(createDef(dom))) as any;
    expect(snapshot.messages[0].contentMarkdown).toContain('$$E=mc^2$$');
    expect(snapshot.messages[0].contentMarkdown).not.toContain('```');
  });

  it('requires manual prepared capture and keeps the homepage available but not persistable', async () => {
    const dom = setupYuanbaoDom(item(0, 'human', '<div class="hyc-content-text">hello</div>'));
    const def = createDef(dom);
    let clock = 0;
    const preparedCapture = await def.collector.prepareManualCapture({
      maxRounds: 1,
      stableRounds: 1,
      waitForLoadMs: 1,
      pollMs: 1,
      now: () => clock,
      sleep: async () => {
        clock += 1;
      },
    });
    expect(await def.collector.capture({ preparedCapture })).toBeNull();
    expect(await def.collector.capture({ manual: true, preparedCapture })).toBeTruthy();

    const home = setupYuanbaoDom('', 'https://yuanbao.tencent.com/');
    const homeDef = createDef(home);
    expect(homeDef.collector.isCaptureAvailable()).toBe(true);
    expect(await homeDef.collector.prepareManualCapture()).toBeNull();
  });
});
