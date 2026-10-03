import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createKimiCollectorDef } from '../../src/collectors/kimi/kimi-collector.ts';

function setupKimiDom(items: string, url = 'https://www.kimi.com/chat/conv001') {
  const dom = new JSDOM(
    `<body>
      <main class="chat-content">
        <div class="chat-detail-main">
          <div class="chat-content-list">${items}</div>
        </div>
      </main>
      <div class="chat-input-editor" role="textbox" contenteditable="true"></div>
    </body>`,
    { url, pretendToBeVisual: true },
  );
  const scroll = dom.window.document.querySelector('.chat-detail-main') as HTMLElement;
  (scroll as any).scrollTo = ({ top = 0 }: { top?: number }) => {
    scroll.scrollTop = top;
    scroll.dispatchEvent(new dom.window.Event('scroll'));
  };
  return dom;
}

function item(id: string, role: 'user' | 'assistant', content: string) {
  return `<div class="chat-content-item chat-content-item-${role}" data-archer-id="${id}" ${
    role === 'user' ? `data-conversation-turn-id="${id}"` : ''
  }>${content}</div>`;
}

function createDef(dom: JSDOM) {
  return createKimiCollectorDef(
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

describe('kimi-collector', () => {
  it('captures current stable segment ids and user uploaded images', async () => {
    const dom = setupKimiDom(
      item(
        'user-1',
        'user',
        `<div class="attachment-list"><div class="attachment-list-image single"><img src="https://www.kimi.com/apiv2-files/sign-obj/kimi-fs/files/blob/abc?filename=1.jpg&sig=xxx&t=t"></div></div><div class="user-content">这是什么</div>`,
      ),
    );
    const snap = (await capturePrepared(createDef(dom))) as any;

    expect(snap.captureMeta.completeness).toBe('partial');
    expect(snap.messages).toHaveLength(1);
    expect(snap.messages[0]).toMatchObject({ messageKey: 'kimi_user-1', role: 'user' });
    expect(snap.messages[0].contentMarkdown).toContain('这是什么');
    expect(snap.messages[0].contentMarkdown).toContain('![](https://www.kimi.com/apiv2-files/sign-obj/');
  });

  it('uses the active Kimi history title without the brand suffix', async () => {
    const dom = setupKimiDom(item('user-title', 'user', '<div class="user-content">标题测试正文</div>'));
    dom.window.document.title = '标题测试 - Kimi';
    dom.window.document.body.insertAdjacentHTML(
      'afterbegin',
      '<a class="next-sidebar-history-item__link" href="/chat/conv001?chat_enter_method=history">真实 Kimi 标题</a>',
    );

    const snap = (await capturePrepared(createDef(dom))) as any;
    expect(snap.conversation.title).toBe('真实 Kimi 标题');
  });

  it('extracts assistant markdown and excludes think-stage content', async () => {
    const dom = setupKimiDom(
      item('user-1', 'user', '<div class="user-content">你好</div>') +
        item(
          'assistant-1',
          'assistant',
          `<div class="think-stage"><div class="markdown-container"><div class="markdown"><p>隐藏思考</p></div></div></div>
          <div class="markdown-container"><div class="markdown">
            <h1>GitHub Actions 自动化部署</h1>
            <blockquote><div class="paragraph">CI/CD 是现代开发的重要实践。</div></blockquote>
            <ol start="1"><li><div class="paragraph">配置 <code class="segment-code-inline">npm</code> 脚本</div></li></ol>
            <div class="segment-code"><header class="segment-code-header"><span class="segment-code-lang">yaml</span><button>复制</button></header><pre class="language-yaml"><code class="language-yaml">name: CI</code></pre></div>
            <table><thead><tr><th>事件</th><th>说明</th></tr></thead><tbody><tr><td><code>push</code></td><td>触发部署</td></tr></tbody></table>
            <a href="https://docs.github.com/en/actions">Actions 文档</a>
          </div></div>`,
        ),
    );
    const snap = (await capturePrepared(createDef(dom))) as any;
    const assistant = snap.messages.find((message: any) => message.role === 'assistant');

    expect(assistant.messageKey).toBe('kimi_assistant-1');
    expect(assistant.contentMarkdown).toContain('# GitHub Actions 自动化部署');
    expect(assistant.contentMarkdown).toContain('> CI/CD 是现代开发的重要实践。');
    expect(assistant.contentMarkdown).toContain('1. 配置 `npm` 脚本');
    expect(assistant.contentMarkdown).toContain('```yaml');
    expect(assistant.contentMarkdown).toContain('| 事件 | 说明 |');
    expect(assistant.contentMarkdown).toContain('[Actions 文档](https://docs.github.com/en/actions)');
    expect(assistant.contentMarkdown).not.toContain('隐藏思考');
    expect(assistant.contentMarkdown).not.toContain('复制');
  });

  it('harvests older lazy-loaded segments but remains partial-safe because hasPreviousPage is not exposed in DOM', async () => {
    const dom = setupKimiDom(item('new', 'user', '<div class="user-content">new</div>'));
    const def = createDef(dom);
    let clock = 0;
    let loaded = false;
    const snap = (await capturePrepared(def, {
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
        older.className = 'chat-content-item chat-content-item-user';
        older.setAttribute('data-archer-id', 'old');
        older.innerHTML = '<div class="user-content">old</div>';
        dom.window.document.querySelector('.chat-content-list')?.prepend(older);
      },
    })) as any;

    expect(snap.captureMeta.completeness).toBe('partial');
    expect(snap.captureMeta.reasons).toContain('top_not_reached');
    expect(snap.messages.map((message: any) => message.messageKey)).toEqual(['kimi_old', 'kimi_new']);
  });

  it('auto-captures the current safe window while manual capture still backfills history', async () => {
    const dom = setupKimiDom(item('one', 'user', '<div class="user-content">hello</div>'));
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

    const auto = await def.collector.capture();
    expect(auto).toMatchObject({
      conversation: { source: 'kimi', conversationKey: 'conv001' },
      captureMeta: { completeness: 'partial', identityVerified: true },
    });
    expect(auto.captureMeta.reasons).toContain('top_not_reached');
    expect(auto.messages.map((message: any) => message.messageKey)).toEqual(['kimi_one']);
    expect(await def.collector.capture({ manual: true, preparedCapture })).toBeTruthy();

    const home = setupKimiDom('', 'https://www.kimi.com/');
    expect(createDef(home).collector.isCaptureAvailable()).toBe(true);
    expect(await createDef(home).collector.capture()).toBeNull();
    expect(await createDef(home).collector.prepareManualCapture()).toBeNull();
  });

  it('excludes the current streaming assistant until Kimi removes its last-node marker', async () => {
    const dom = setupKimiDom(
      item('user-1', 'user', '<div class="user-content">question</div>') +
        item(
          'assistant-1',
          'assistant',
          '<div class="markdown-container"><div class="markdown"><p class="last-node">partial answer</p></div></div>',
        ),
    );
    const def = createDef(dom);

    const streaming = await def.collector.capture();
    expect(streaming.captureMeta.reasons).toContain('unresolved_turn');
    expect(streaming.messages.map((message: any) => message.messageKey)).toEqual(['kimi_user-1']);

    dom.window.document.querySelector('.last-node')?.classList.remove('last-node');
    const completed = await def.collector.capture();
    expect(completed.messages.map((message: any) => message.messageKey)).toEqual(['kimi_user-1', 'kimi_assistant-1']);
    expect(completed.messages[1].contentMarkdown).toContain('partial answer');
  });

  it('falls back to plain text markdown when markdown helper is unavailable', async () => {
    vi.resetModules();
    vi.doMock('../../src/collectors/kimi/kimi-markdown.ts', () => ({ default: {} }));
    const { createKimiCollectorDef: createDefWithoutMarkdown } =
      await import('../../src/collectors/kimi/kimi-collector.ts');
    const dom = setupKimiDom(
      item('assistant-plain', 'assistant', '<div class="markdown-container"><div>plain answer</div></div>'),
      'https://www.kimi.com/chat/fallback001',
    );
    const def = createDefWithoutMarkdown(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
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
    const snap = (await def.collector.capture({ manual: true, preparedCapture })) as any;
    expect(snap.messages[0].contentMarkdown).toBe('plain answer');
  });
});
