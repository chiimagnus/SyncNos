import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createDeepseekCollectorDef } from '../../src/collectors/deepseek/deepseek-collector.ts';

function setupDeepseekDom(messages: string, url = 'https://chat.deepseek.com/a/chat/s/abc123') {
  const dom = new JSDOM(
    `<body>
      <div class="ds-virtual-list" style="overflow-y:auto">
        <div class="ds-virtual-list-items">
          <div class="ds-virtual-list-visible-items" style="--dsl-virtual-list-transform-y:0px;transform:translateY(0px)">
            ${messages}
          </div>
        </div>
      </div>
      <textarea placeholder="给 DeepSeek 发送消息 "></textarea>
    </body>`,
    { url },
  );
  (dom.window as any).scrollTo = vi.fn();
  return dom;
}

function item(key: string, content: string) {
  return `<div data-virtual-list-item-key="${key}">${content}</div>`;
}

function user(text: string) {
  return `<div class="ds-message"><div class="fbb737a4">${text}</div></div>`;
}

function assistant(content: string, thinking = '') {
  return `<div class="ds-message">
    ${thinking ? `<div><div class="ds-think-content">${thinking}</div></div>` : ''}
    <div class="ds-markdown ds-assistant-message-main-content">${content}</div>
  </div>`;
}

function createDef(dom: JSDOM) {
  return createDeepseekCollectorDef(
    createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    }),
  ) as any;
}

async function capturePrepared(def: any, options: Record<string, unknown> = {}) {
  const preparedCapture = await def.collector.prepareManualCapture({
    stableSamples: 1,
    pollMs: 0,
    stepTimeoutMs: 20,
    boundaryTimeoutMs: 20,
    sleep: async () => {},
    ...options,
  });
  return preparedCapture ? def.collector.capture({ manual: true, preparedCapture }) : null;
}

describe('deepseek-collector', () => {
  it('captures current semantic virtual-list items with stable keys and final assistant markdown only', async () => {
    const dom = setupDeepseekDom(
      item('1', user('你好')) +
        item(
          '2',
          assistant(
            `
              <h1><span>主标题</span></h1>
              <blockquote><p class="ds-markdown-paragraph"><span>引用内容</span></p></blockquote>
              <ul><li><p class="ds-markdown-paragraph"><span>父级条目</span></p><ul><li><p>子级条目</p></li></ul></li></ul>
              <ol start="2"><li><p class="ds-markdown-paragraph"><span>第二项</span></p></li></ol>
              <p><strong>粗体</strong> <em>斜体</em> <code>sum(1,2)</code> <a href="https://example.com">链接</a></p>
              <table><thead><tr><th>语法元素</th><th>说明</th></tr></thead><tbody><tr><td>标题</td><td>使用 #</td></tr></tbody></table>
              <div class="md-code-block md-code-block-dark">
                <div class="md-code-block-banner-wrap"><div class="md-code-block-infostring">python</div><button>复制</button></div>
                <pre><span>def greet(name):</span><br><span>    return f"Hello, {name}"</span></pre>
              </div>
            `,
            '内部思考不应进入最终正文',
          ),
        ),
    );

    const snapshot = (await capturePrepared(createDef(dom))) as any;
    expect(snapshot.captureMeta.completeness).toBe('complete');
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual(['deepseek_1', 'deepseek_2']);
    expect(snapshot.messages[0]).toMatchObject({ role: 'user', contentMarkdown: '你好' });

    const markdown = snapshot.messages[1].contentMarkdown;
    expect(markdown).toContain('# 主标题');
    expect(markdown).toContain('> 引用内容');
    expect(markdown).toContain('- 父级条目');
    expect(markdown).toContain('  - 子级条目');
    expect(markdown).toContain('2. 第二项');
    expect(markdown).toContain('**粗体**');
    expect(markdown).toContain('*斜体*');
    expect(markdown).toContain('`sum(1,2)`');
    expect(markdown).toContain('[链接](https://example.com)');
    expect(markdown).toContain('| 语法元素 | 说明 |');
    expect(markdown).toContain('```python');
    expect(markdown).not.toContain('复制');
    expect(markdown).not.toContain('内部思考');
  });

  it('keeps a think-only assistant unresolved instead of saving a partial response', async () => {
    const dom = setupDeepseekDom(
      item('1', user('question')) +
        item('2', '<div class="ds-message"><div class="ds-think-content">正在思考</div></div>'),
    );
    const def = createDef(dom);
    let clock = 0;
    const snapshot = (await capturePrepared(def, {
      stepTimeoutMs: 2,
      boundaryTimeoutMs: 2,
      totalDeadlineMs: 20,
      now: () => clock,
      sleep: async () => {
        clock += 2;
      },
    })) as any;

    expect(snapshot.captureMeta.completeness).toBe('partial');
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0]).toMatchObject({ messageKey: 'deepseek_1', role: 'user' });
  });

  it('uses virtual-list transform as the logical top boundary', () => {
    const dom = setupDeepseekDom(item('3', user('visible')));
    const def = createDef(dom);
    const visible = dom.window.document.querySelector('.ds-virtual-list-visible-items') as HTMLElement;
    const root = dom.window.document.querySelector('.ds-virtual-list') as HTMLElement;

    Object.defineProperty(root, 'scrollTop', { configurable: true, writable: true, value: 0 });
    visible.style.setProperty('--dsl-virtual-list-transform-y', '240px');
    expect(def.collector.__test.readBoundaryState('top')).toBe('pending');

    visible.style.setProperty('--dsl-virtual-list-transform-y', '0px');
    expect(def.collector.__test.readBoundaryState('top')).toBe('confirmed');
  });

  it('auto-captures the current safe window while manual capture still uses prepared history', async () => {
    const dom = setupDeepseekDom(item('1', user('hello')), 'https://chat.deepseek.com/a/chat/s/manual1');
    const def = createDef(dom);
    const preparedCapture = await def.collector.prepareManualCapture({
      stableSamples: 1,
      pollMs: 0,
      sleep: async () => {},
    });

    const auto = await def.collector.capture();
    expect(auto).toMatchObject({
      conversation: { source: 'deepseek', conversationKey: 'manual1' },
      captureMeta: { completeness: 'partial', identityVerified: true },
    });
    expect(auto.captureMeta.reasons).toContain('top_not_reached');
    expect(auto.messages.map((message: any) => message.messageKey)).toEqual(['deepseek_1']);
    expect(await def.collector.capture({ manual: true, preparedCapture })).toBeTruthy();

    const home = setupDeepseekDom('', 'https://chat.deepseek.com/');
    const homeDef = createDef(home);
    expect(homeDef.collector.isCaptureAvailable()).toBe(true);
    expect(await homeDef.collector.prepareManualCapture()).toBeNull();
  });
});
