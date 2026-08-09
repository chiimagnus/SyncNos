import * as fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createChatgptCollectorDef, turnKeyOf } from '../../src/collectors/chatgpt/chatgpt-collector.ts';
import chatgptMarkdown from '../../src/collectors/chatgpt/chatgpt-markdown.ts';

function setupChatgptDom(html: string, url: string) {
  const dom = new JSDOM(`<body><main>${html}</main></body>`, { url });
  return dom;
}

async function capturePrepared(def: any, prepareOptions: any = {}) {
  const preparedCapture = await def.collector.prepareManualCapture({
    stableSamples: 1,
    pollMs: 0,
    sleep: async () => {},
    ...prepareOptions,
  });
  if (!preparedCapture) return null;
  return def.collector.capture({ manual: true, preparedCapture });
}

describe('chatgpt-collector', () => {
  it('uses active conversation title in ChatGPT Projects pages (instead of project name h1)', async () => {
    const html = `
      <h1>Research</h1>
      <nav>
        <a href="/g/p_1/c/conv_project_1" aria-current="page"><span>GPR signal preprocessing</span></a>
      </nav>
      <div data-message-author-role="user"><div class="whitespace-pre-wrap">Q</div></div>
      <div data-message-author-role="assistant" data-message-id="m_ai_1">
        <div class="markdown prose"><p>A</p></div>
      </div>
    `;

    const dom = setupChatgptDom(html, 'https://chatgpt.com/g/p_1/c/conv_project_1');
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await capturePrepared(createChatgptCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    expect(snap.conversation.title).toBe('GPR signal preprocessing');
  });

  it('derives a stable temporary conversation key from the canonical top turn anchor', async () => {
    const html = `
      <article data-testid="conversation-turn-1" data-turn-id="turn_tmp_user">
        <div data-message-author-role="user"><div class="whitespace-pre-wrap">请帮我整理今天的发布检查清单</div></div>
      </article>
      <article data-testid="conversation-turn-2" data-turn-id="turn_tmp_assistant">
        <div data-message-author-role="assistant" data-message-id="m_ai_tmp_1">
          <div class="markdown prose"><p>好的，我们先从回归范围开始。</p></div>
        </div>
      </article>
    `;

    const dom = setupChatgptDom(html, 'https://chatgpt.com/?temporary-chat=true');
    dom.window.document.title = 'ChatGPT';
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const def = createChatgptCollectorDef(env) as any;
    const preparedCapture = await def.collector.prepareManualCapture({ stableSamples: 1, pollMs: 0 });
    const snap = (await Promise.resolve(def.collector.capture({ manual: true, preparedCapture }))) as any;
    expect(snap).toBeTruthy();
    expect(String(snap.conversation.conversationKey || '')).toMatch(/^chatgpt_/);
    expect(snap.captureMeta).toMatchObject({ completeness: 'complete', identityVerified: true });
    expect(snap.messages.every((message: any) => !String(message.messageKey).startsWith('fallback_'))).toBe(true);
    expect(String(snap.conversation.title || '')).toBe('请帮我整理今天的发布检查清单');
    expect(String(snap.conversation.title || '')).not.toBe('ChatGPT');
  });

  it('keeps the temporary conversation key stable across first-user edits and history growth', async () => {
    async function capture(text: string, includeExtra: boolean) {
      const html = `
        <article data-testid="conversation-turn-1" data-turn-id="turn_stable_top">
          <div data-message-author-role="user"><div class="whitespace-pre-wrap">${text}</div></div>
        </article>
        <article data-testid="conversation-turn-2" data-turn-id="turn_stable_answer">
          <div data-message-author-role="assistant"><div class="markdown prose"><p>answer</p></div></div>
        </article>
        ${
          includeExtra
            ? '<article data-testid="conversation-turn-3" data-turn-id="turn_extra"><div data-message-author-role="user"><div class="whitespace-pre-wrap">extra</div></div></article>'
            : ''
        }
      `;
      const dom = setupChatgptDom(html, 'https://chatgpt.com/?temporary-chat=true');
      const env = createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      });
      return (await capturePrepared(createChatgptCollectorDef(env))) as any;
    }

    const before = await capture('first draft', false);
    const after = await capture('edited prompt', true);
    expect(before.conversation.conversationKey).toBe(after.conversation.conversationKey);
  });

  it('marks an unprepared unstable live snapshot as unverified so persistence rejects it', async () => {
    const dom = setupChatgptDom(
      '<div data-message-author-role="user"><div class="whitespace-pre-wrap">unstable</div></div>',
      'https://chatgpt.com/?temporary-chat=true',
    );
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const snap = await createChatgptCollectorDef(env).collector.capture({ manual: true });
    expect(snap).toBeNull();
  });

  it('does not verify temporary-chat identity from an empty structural turn shell', async () => {
    const dom = setupChatgptDom(
      '<article data-testid="conversation-turn-1"><div data-message-author-role="user"><div class="whitespace-pre-wrap">unstable shell</div></div></article>',
      'https://chatgpt.com/?temporary-chat=true',
    );
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const def = createChatgptCollectorDef(env) as any;
    const guard = def.collector.__test.sampleIdentityGuard(dom.window.document.querySelector('main'));
    expect(guard.anchors).toEqual([]);
    expect(def.collector.__test.identityConversationKey(guard)).toBe('');

    const snapshot = await def.collector.capture({ manual: true });
    expect(snapshot).toBeNull();
  });

  it('extracts assistant contentMarkdown from semantic markdown DOM', async () => {
    const html = `
      <article data-testid="conversation-turn-1" data-turn-id="turn_md_user">
        <div data-message-author-role="user"><div class="whitespace-pre-wrap">你好</div></div>
      </article>
      <article data-testid="conversation-turn-2" data-turn-id="turn_md_assistant">
        <div data-message-author-role="assistant" data-message-id="m_ai_1">
          <div class="markdown prose">
            <h1>主标题</h1>
            <blockquote><p>这是引用</p></blockquote>
            <ul>
              <li>
                <p>父级条目</p>
                <ul>
                  <li><p>子级条目</p></li>
                </ul>
              </li>
            </ul>
            <ol start="3"><li><p>第三项</p></li></ol>
            <table>
              <thead><tr><th>类型</th><th>特征</th></tr></thead>
              <tbody><tr><td>深度工作</td><td>高专注</td></tr></tbody>
            </table>
            <pre>
              <div class="relative">
                <div class="sticky"><div>代码</div><button aria-label="复制">复制</button></div>
                <div id="code-block-viewer" class="cm-editor">
                  <div class="cm-scroller">
                    <div class="cm-content"><span>const a = 1;</span><br><span>console.log(a);</span></div>
                  </div>
                </div>
              </div>
            </pre>
            <p><strong>粗体</strong> <em>斜体</em> <code>sum(1,2)</code> <a href="https://example.com">链接</a></p>
            <hr />
          </div>
        </div>
      </article>
    `;

    const dom = setupChatgptDom(html, 'https://chatgpt.com/c/conv_md_1');
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await capturePrepared(createChatgptCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);

    const assistant = snap.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).toContain('# 主标题');
    expect(assistant.contentMarkdown).toContain('> 这是引用');
    expect(assistant.contentMarkdown).toContain('- 父级条目');
    expect(assistant.contentMarkdown).toContain('  - 子级条目');
    expect(assistant.contentMarkdown).toContain('3. 第三项');
    expect(assistant.contentMarkdown).toContain('| 类型 | 特征 |');
    expect(assistant.contentMarkdown).toContain('```');
    expect(assistant.contentMarkdown).toContain('const a = 1;');
    expect(assistant.contentMarkdown).toContain('console.log(a);');
    expect(assistant.contentMarkdown).toContain('**粗体**');
    expect(assistant.contentMarkdown).toContain('*斜体*');
    expect(assistant.contentMarkdown).toContain('`sum(1,2)`');
    expect(assistant.contentMarkdown).toContain('[链接](https://example.com)');
    expect(assistant.contentMarkdown).toContain('---');
    expect(assistant.contentMarkdown).not.toContain('复制');

    expect(assistant.contentText).toContain('主标题');
    expect(assistant.contentText).toContain('console.log(a);');
    expect(assistant.contentText).not.toContain('复制');
  });

  it('extracts multiple assistant messages inside an agent-turn container', async () => {
    const html = `
      <div data-message-author-role="user" data-message-id="m_user_1"><div class="whitespace-pre-wrap">Q</div></div>
      <div class="group/turn-messages flex flex-col agent-turn">
        <div data-message-author-role="assistant" data-message-id="m_ai_1" class="text-message">
          <div class="markdown prose"><p>first</p></div>
        </div>
        <div class="flex items-center justify-between">
          <button type="button">Thought for 1s</button>
        </div>
        <div data-message-author-role="assistant" data-message-id="m_ai_2" class="text-message">
          <div class="markdown prose"><p>second</p></div>
        </div>
      </div>
    `;

    const dom = setupChatgptDom(html, 'https://chatgpt.com/c/conv_agent_turn_1');
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await capturePrepared(createChatgptCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(snap.messages.map((m: any) => m.contentText)).toEqual(['Q', 'first', 'second']);
  });

  it('preserves hidden mermaid code blocks that are rendered as diagrams', async () => {
    const html = `
      <article data-testid="conversation-turn-1">
        <div data-message-author-role="assistant" data-message-id="m_ai_mermaid">
          <div class="markdown prose">
            <p>下面是一个 mermaid：</p>
            <div class="mermaid">
              <svg aria-hidden="true"><path d="M0 0" /></svg>
              <pre class="sr-only" aria-hidden="true"><code class="language-mermaid">graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[OK]\n  B -->|No| D[Retry]</code></pre>
            </div>
          </div>
        </div>
      </article>
    `;

    const dom = setupChatgptDom(html, 'https://chatgpt.com/c/conv_mermaid_1');
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await capturePrepared(createChatgptCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe('assistant');
    expect(snap.messages[0].contentMarkdown).toContain('```mermaid');
    expect(snap.messages[0].contentMarkdown).toContain('graph TD');
    expect(snap.messages[0].contentText).toContain('graph TD');
  });

  it('captures multiple deep-research iframes with identical src as distinct reports', async () => {
    const html = `
      <section data-testid="conversation-turn-1" data-turn="user" data-turn-id="u1">
        <div data-message-author-role="user"><div class="whitespace-pre-wrap">Q</div></div>
      </section>
      <section data-testid="conversation-turn-2" data-turn="assistant" data-turn-id="a1">
        <div class="agent-turn">
          <iframe title="internal://deep-research" src="https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop"></iframe>
        </div>
      </section>
      <section data-testid="conversation-turn-3" data-turn="assistant" data-turn-id="a2">
        <div class="agent-turn">
          <iframe title="internal://deep-research" src="https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop"></iframe>
        </div>
      </section>
      <section data-testid="conversation-turn-4" data-turn="assistant" data-turn-id="a3">
        <div class="agent-turn">
          <iframe title="internal://deep-research" src="https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop"></iframe>
        </div>
      </section>
    `;

    const dom = setupChatgptDom(html, 'https://chatgpt.com/c/conv_deep_research_multi_1');
    const iframes = Array.from(dom.window.document.querySelectorAll('iframe')) as any[];
    expect(iframes.length).toBe(3);

    const mkFrame = (title: string, body: string) => {
      const win = {
        postMessage: (msg: any) => {
          const requestId = msg?.requestId;
          dom.window.dispatchEvent(
            new (dom.window as any).MessageEvent('message', {
              data: {
                __syncnos: true,
                type: 'SYNCNOS_DEEP_RESEARCH_RESPONSE',
                requestId,
                title,
                markdown: `# ${title}\n\n${body}`,
                text: `${title}\n\n${body}`,
              },
              origin: 'https://connector_openai_deep_research.web-sandbox.oaiusercontent.com',
              source: win as any,
            }),
          );
        },
      };
      return win;
    };

    const w1 = mkFrame('Report A', 'Body A');
    const w2 = mkFrame('Report A', 'Body A');
    const w3 = mkFrame('Report B', 'Body B');
    Object.defineProperty(iframes[0], 'contentWindow', { configurable: true, value: w1 });
    Object.defineProperty(iframes[1], 'contentWindow', { configurable: true, value: w2 });
    Object.defineProperty(iframes[2], 'contentWindow', { configurable: true, value: w3 });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await capturePrepared(createChatgptCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    const assistant = snap.messages.filter((m: any) => m.role === 'assistant');
    expect(assistant.length).toBe(3);
    // When multiple deep-research iframes exist, we prefer stable placeholders and let the hydrator fill the body.
    expect(String(assistant[0].contentText)).toContain('Deep Research (iframe)');
    expect(String(assistant[1].contentText)).toContain('Deep Research (iframe)');
    expect(String(assistant[2].contentText)).toContain('Deep Research (iframe)');
    expect(String(assistant[0].messageKey || '')).not.toBe(String(assistant[1].messageKey || ''));
  });

  it('falls back to deep-research placeholder when iframe extraction returns empty, even with sr-only label', async () => {
    const html = `
      <article data-testid="conversation-turn-4" data-turn="assistant" data-turn-id="t1">
        <h6 class="sr-only select-none">ChatGPT说:</h6>
        <div class="agent-turn">
          <iframe title="internal://deep-research" src="https://connector_openai_deep_research.web-sandbox.oaiusercontent.com/?app=chatgpt&locale=zh-CN"></iframe>
        </div>
      </article>
    `;

    const dom = setupChatgptDom(html, 'https://chatgpt.com/c/conv_deep_research_fallback_1');
    const iframe = dom.window.document.querySelector('iframe') as any;
    expect(iframe).toBeTruthy();

    const fakeFrameWindow = {
      postMessage: (msg: any) => {
        const requestId = msg?.requestId;
        dom.window.dispatchEvent(
          new (dom.window as any).MessageEvent('message', {
            data: {
              __syncnos: true,
              type: 'SYNCNOS_DEEP_RESEARCH_RESPONSE',
              requestId,
              title: 'Deep Research',
              markdown: '',
              text: '',
            },
            origin: 'https://connector_openai_deep_research.web-sandbox.oaiusercontent.com',
            source: fakeFrameWindow as any,
          }),
        );
      },
    };
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: fakeFrameWindow });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await capturePrepared(createChatgptCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe('assistant');
    expect(String(snap.messages[0].contentText)).toMatch(/^Deep Research \(iframe\):/);
    expect(String(snap.messages[0].contentText)).toContain(
      'connector_openai_deep_research.web-sandbox.oaiusercontent.com',
    );
    expect(String(snap.messages[0].contentText)).not.toContain('ChatGPT说');
  });

  it('falls back to plain text markdown when markdown helper is unavailable', async () => {
    const html = `
      <article data-testid="conversation-turn-1" data-turn-id="turn_fallback">
        <div data-message-author-role="assistant" data-message-id="m_fallback">
          <div class="markdown prose"><p>plain answer</p></div>
        </div>
      </article>
    `;

    const extractAssistantText = chatgptMarkdown.extractAssistantText;
    const extractAssistantMarkdown = chatgptMarkdown.extractAssistantMarkdown;
    (chatgptMarkdown as any).extractAssistantText = undefined;
    (chatgptMarkdown as any).extractAssistantMarkdown = undefined;
    try {
      const dom = setupChatgptDom(html, 'https://chatgpt.com/c/conv_fallback_1');
      const env = createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      });

      const snap = (await capturePrepared(createChatgptCollectorDef(env))) as any;
      expect(snap).toBeTruthy();
      expect(snap.messages.length).toBe(1);
      expect(snap.messages[0].role).toBe('assistant');
      expect(snap.messages[0].contentText).toBe('plain answer');
      expect(snap.messages[0].contentMarkdown).toBe('plain answer');
    } finally {
      chatgptMarkdown.extractAssistantText = extractAssistantText;
      chatgptMarkdown.extractAssistantMarkdown = extractAssistantMarkdown;
    }
  });
});

describe('chatgpt turn identity primitive', () => {
  it('resolves the same turn UUID from a role node and its shell', () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <section data-testid="conversation-turn-1" data-turn-id="turn_a">
        <div data-message-author-role="user"><div class="whitespace-pre-wrap">你好</div></div>
      </section>
    </body></html>`);
    const roleNode = dom.window.document.querySelector('[data-message-author-role="user"]') as any;
    const shell = dom.window.document.querySelector('[data-testid="conversation-turn-1"]') as any;
    expect(turnKeyOf(roleNode)).toBe('turn_a');
    expect(turnKeyOf(shell)).toBe('turn_a');
  });
});

describe('chatgpt virtualized share fixture (5 rounds)', () => {
  function loadFixture() {
    const html = fs.readFileSync(new URL('../fixtures/chatgpt-share-virtualized.html', import.meta.url), 'utf8');
    // F2: the real share DOM has no <main>; load it as a FULL document (no main wrapper).
    return new JSDOM(html, { url: 'https://chatgpt.com/share/6a422ac4-0fac-83ee-8050-90dec7c22b89' });
  }

  it('asserts captured fixture facts without treating spacer selectors as completeness proof', () => {
    const dom = loadFixture();
    const doc = dom.window.document;
    expect(doc.querySelectorAll('main')).toHaveLength(0);
    const nestedDuplicates = Array.from(doc.querySelectorAll('[data-turn-id-container]')).filter((element) =>
      element.parentElement?.hasAttribute('data-turn-id-container'),
    );
    expect(nestedDuplicates.length).toBeGreaterThan(0);
    const turns = Array.from(
      doc.querySelectorAll("[data-testid^='conversation-turn-'], [data-testid='conversation-turn']"),
    );
    expect(turns.some((turn) => !turn.querySelector('[data-message-author-role]') && !turn.textContent?.trim())).toBe(
      true,
    );
    expect(turns.some((turn) => turn.querySelectorAll('[data-message-author-role]').length > 1)).toBe(true);
  });

  it('re-queries fresh descriptors and snapshots plain extraction input in one scan', () => {
    const dom = loadFixture();
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const def = createChatgptCollectorDef(env) as any;
    const adapter = def.collector.__test.manualAdapter;
    const beforeWindow = adapter.readWindow();
    const before = beforeWindow.descriptors;
    expect(before).toHaveLength(12);
    expect(before.filter((descriptor: any) => descriptor.key).length).toBe(12);
    const first = before[0];
    const input = beforeWindow.inputsByKey.get(first.key);
    expect(JSON.parse(JSON.stringify(input))).toEqual(input);
    expect(input.outerHtml).toEqual(expect.any(String));
    expect(Object.values(input).some((value) => value instanceof dom.window.Element)).toBe(false);

    const firstRole = dom.window.document.querySelector('[data-message-author-role]') as HTMLElement;
    firstRole.querySelector('.whitespace-pre-wrap, .markdown')!.textContent = 'replacement content';
    const after = adapter.readDescriptors();
    expect(after[0].key).toBe(first.key);
    expect(after[0].fingerprint).not.toBe(first.fingerprint);
  });

  it('retries a rendered message when its first plain snapshot is transiently unavailable', async () => {
    const dom = setupChatgptDom(
      `
        <article data-testid="conversation-turn-1" data-turn-id="turn_retry">
          <div data-message-author-role="assistant"><div class="markdown prose"><p>retry me</p></div></div>
        </article>
      `,
      'https://chatgpt.com/c/conv_retry',
    );
    (dom.window as any).scrollTo = vi.fn();
    const def = createChatgptCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    const adapter = def.collector.__test.manualAdapter;
    const originalReadWindow = adapter.readWindow;
    let remainingMisses = 1;
    adapter.readWindow = () => {
      const window = originalReadWindow();
      if (remainingMisses > 0) {
        remainingMisses -= 1;
        return { ...window, inputsByKey: new Map() };
      }
      return window;
    };

    const prepared = await def.collector.prepareManualCapture({
      maxPasses: 2,
      maxSteps: 4,
      stableSamples: 1,
      pollMs: 0,
      stepTimeoutMs: 20,
    });

    expect(remainingMisses).toBe(0);
    expect(prepared.records.map((record: any) => record.payload.contentText)).toEqual(['retry me']);
  });

  it('bounds manual extraction to new or changed descriptor fingerprints', async () => {
    const dom = setupChatgptDom(
      `
        <article data-testid="conversation-turn-1" data-turn-id="turn_cost_user">
          <div data-message-author-role="user"><div class="whitespace-pre-wrap">question</div></div>
        </article>
        <article data-testid="conversation-turn-2" data-turn-id="turn_cost_answer">
          <div data-message-author-role="assistant"><div class="markdown prose"><p>draft answer</p></div></div>
        </article>
      `,
      'https://chatgpt.com/c/conv_cost',
    );
    (dom.window as any).scrollTo = vi.fn();
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const def = createChatgptCollectorDef(env) as any;
    const prepared = await def.collector.prepareManualCapture({
      maxPasses: 2,
      maxSteps: 4,
      stableSamples: 1,
      pollMs: 0,
      stepTimeoutMs: 20,
    });

    expect(prepared.completeness).toBe('complete');
    expect(def.collector.__test.manualAdapter.getExtractionCount()).toBe(2);
    expect(JSON.parse(JSON.stringify(prepared))).toEqual(prepared);
    const containsLiveElement = (value: any): boolean => {
      if (value instanceof dom.window.Element) return true;
      if (!value || typeof value !== 'object') return false;
      return Object.values(value).some((child) => containsLiveElement(child));
    };
    expect(containsLiveElement(prepared)).toBe(false);

    const answer = dom.window.document.querySelector('.markdown.prose p') as HTMLElement;
    answer.textContent = 'final answer';
    const snapshot = await def.collector.capture({ manual: true, preparedCapture: prepared });
    expect(def.collector.__test.manualAdapter.getExtractionCount()).toBe(3);
    expect(snapshot.messages.map((message: any) => message.contentText)).toEqual(['question', 'final answer']);
    expect(snapshot.captureMeta).toMatchObject({ completeness: 'partial' });
    expect(snapshot.captureMeta.reasons).toContain('final_live_changed');
  });

  it('keeps Deep Research manual extraction synchronous and emits only a placeholder', async () => {
    const dom = setupChatgptDom(
      `
        <article data-testid="conversation-turn-1" data-turn-id="turn_report">
          <div data-message-author-role="assistant">
            <iframe title="internal://deep-research" src="https://connector_openai_deep_research.web-sandbox.oaiusercontent.com/report-a"></iframe>
          </div>
        </article>
      `,
      'https://chatgpt.com/c/conv_report',
    );
    (dom.window as any).scrollTo = vi.fn();
    const iframe = dom.window.document.querySelector('iframe') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: { postMessage } });
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const def = createChatgptCollectorDef(env) as any;
    const prepared = await def.collector.prepareManualCapture({
      maxPasses: 2,
      maxSteps: 4,
      stableSamples: 1,
      pollMs: 0,
      stepTimeoutMs: 20,
    });

    expect(postMessage).not.toHaveBeenCalled();
    expect(prepared.records).toHaveLength(1);
    expect(prepared.records[0].payload).toMatchObject({
      contentText:
        'Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com/report-a',
    });
    expect(def.collector.__test.manualAdapter.getExtractionCount()).toBe(1);
  });

  it('keeps content, URLs, stable IDs, and image references out of sweep diagnostics', async () => {
    const sentinel = 'PRIVATE_DIAGNOSTIC_SENTINEL';
    const dom = setupChatgptDom(
      `
        <article data-testid="conversation-turn-1" data-turn-id="${sentinel}_turn">
          <div data-message-author-role="assistant" data-message-id="${sentinel}_message">
            <div class="markdown prose"><p>${sentinel}_body</p></div>
            <img src="https://example.com/${sentinel}_image.png" />
          </div>
        </article>
      `,
      `https://chatgpt.com/c/${sentinel}_conversation`,
    );
    dom.window.document.title = `${sentinel}_title`;
    (dom.window as any).scrollTo = vi.fn();
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const def = createChatgptCollectorDef(env) as any;
    const prepared = await def.collector.prepareManualCapture({
      maxPasses: 2,
      stableSamples: 1,
      pollMs: 0,
      stepTimeoutMs: 20,
    });
    const diagnostics = JSON.stringify({ reasons: prepared.reasons, metrics: prepared.metrics });
    expect(diagnostics).not.toContain(sentinel);
    expect(prepared.reasons.every((reason: string) => /^[a-z][a-z0-9_]*$/.test(reason))).toBe(true);
  });

  it('captures the virtualized fixture as a full document without regression (9 messages, 3 rounds)', async () => {
    const dom = loadFixture();
    expect(dom.window.document.querySelectorAll('main').length).toBe(0);
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const snap = (await capturePrepared(createChatgptCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(9);
    expect(snap.messages.filter((m: any) => m.role === 'user').length).toBe(3);
  });
});

describe('chatgpt manual scroll-sweep capture (P2)', () => {
  function loadFixtureDom() {
    const html = fs.readFileSync(new URL('../fixtures/chatgpt-share-virtualized.html', import.meta.url), 'utf8');
    return new JSDOM(html, { url: 'https://chatgpt.com/share/6a422ac4-0fac-83ee-8050-90dec7c22b89' });
  }
  // JSDOM has no layout. Model a document scroller whose viewport hydrates one shell per step.
  function mockHydrationOnDynamicScroll(dom: JSDOM) {
    const doc = dom.window.document;
    const shells = Array.from(
      doc.querySelectorAll("[data-testid^='conversation-turn-'], [data-testid='conversation-turn']"),
    ).filter(
      (shell) => !shell.querySelector('[data-message-author-role]') && !shell.textContent?.trim(),
    ) as HTMLElement[];
    const injRoles = ['user', 'assistant', 'user'];
    const root = doc.documentElement;
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 500 });
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(root, 'scrollWidth', { configurable: true, value: 100 });
    let top = 0;
    let left = 0;
    const counter = { calls: 0, hydrated: 0 };
    Object.defineProperty(dom.window, 'scrollY', { configurable: true, get: () => top });
    Object.defineProperty(dom.window, 'scrollX', { configurable: true, get: () => left });
    (dom.window as any).scrollTo = (nextLeft: number, nextTop: number) => {
      left = Number(nextLeft) || 0;
      top = Number(nextTop) || 0;
      counter.calls += 1;
      const hydrateCount = Math.min(shells.length, Math.floor(top / 60));
      for (let idx = 0; idx < hydrateCount; idx += 1) {
        const shell = shells[idx];
        if (shell.querySelector('[data-message-author-role]')) continue;
        const role = injRoles[idx] || 'assistant';
        const wrap = doc.createElement('div');
        wrap.setAttribute('data-message-author-role', role);
        wrap.setAttribute('data-message-id', `inj_${idx}`);
        const inner = doc.createElement('div');
        inner.className = role === 'user' ? 'whitespace-pre-wrap' : 'markdown prose';
        inner.textContent = `注入-${role}-${idx}`;
        wrap.appendChild(inner);
        shell.appendChild(wrap);
        counter.hydrated += 1;
      }
    };
    return {
      shells,
      counter,
      getTop: () => top,
      setPosition: (nextLeft: number, nextTop: number) => {
        left = nextLeft;
        top = nextTop;
      },
    };
  }
  function buildEnv(dom: JSDOM) {
    return createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
  }

  it('prepareManualCapture + manual capture recovers all 5 rounds across virtualized shells', async () => {
    const dom = loadFixtureDom();
    (dom.window as any).scrollTo = vi.fn();
    const { shells, counter } = mockHydrationOnDynamicScroll(dom);
    expect(shells.length).toBe(3);
    const def = createChatgptCollectorDef(buildEnv(dom)) as any;

    const preparedCapture = await def.collector.prepareManualCapture({
      stepTimeoutMs: 100,
      pollMs: 0,
      stableSamples: 1,
    });
    expect(counter.hydrated).toBe(3);

    const snap = (await Promise.resolve(def.collector.capture({ manual: true, preparedCapture }))) as any;
    expect(snap.messages.length).toBe(12);
    expect(snap.messages.filter((m: any) => m.role === 'user').length).toBe(5);
    expect(snap.messages.every((m: any, i: number) => m.sequence === i)).toBe(true);
    expect(snap.captureMeta).toMatchObject({ completeness: 'complete', identityVerified: true });
    const injectedPositions = snap.messages
      .map((message: any, index: number) => (String(message.contentText || '').startsWith('注入-') ? index : -1))
      .filter((index: number) => index >= 0);
    expect(injectedPositions).toEqual([3, 4, 5]);
  });

  it('binds temporary-chat identity only after reaching the canonical top', async () => {
    const dom = setupChatgptDom('', 'https://chatgpt.com/?temporary-chat=true');
    const main = dom.window.document.querySelector('main') as HTMLElement;
    const root = dom.window.document.documentElement;
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 200 });
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(root, 'scrollWidth', { configurable: true, value: 100 });
    let top = 100;
    const render = () => {
      const atTop = top < 50;
      main.innerHTML = `
        <article data-testid="conversation-turn-1" data-turn-id="${atTop ? 'turn_top' : 'turn_middle'}">
          <div data-message-author-role="${atTop ? 'user' : 'assistant'}">
            <div class="${atTop ? 'whitespace-pre-wrap' : 'markdown prose'}">${atTop ? 'top' : 'middle'}</div>
          </div>
        </article>
      `;
    };
    render();
    Object.defineProperty(dom.window, 'scrollY', { configurable: true, get: () => top });
    Object.defineProperty(dom.window, 'scrollX', { configurable: true, get: () => 0 });
    (dom.window as any).scrollTo = (_left: number, nextTop: number) => {
      top = Number(nextTop) || 0;
      render();
    };
    const def = createChatgptCollectorDef(buildEnv(dom)) as any;
    const topGuard = {
      route: 'chatgpt.com/?temporary-chat=true',
      durableId: '',
      anchors: ['turn:turn_top', 'turn_top:user:0'],
      topAnchor: 'turn:turn_top',
    };

    const prepared = await def.collector.prepareManualCapture({
      maxPasses: 2,
      maxSteps: 4,
      maxOverlapRecoveries: 0,
      stableSamples: 1,
      pollMs: 0,
      stepTimeoutMs: 20,
    });

    expect(prepared.conversationKey).toBe(def.collector.__test.identityConversationKey(topGuard));
    expect(prepared.identityGuard.topAnchor).toBe('turn:turn_top');
    expect(prepared.identityGuard.anchors).toContain('turn:turn_middle');
    expect(top).toBe(100);
  });

  it('recycles every visible anchor without treating scrolling as navigation', async () => {
    const dom = setupChatgptDom('', 'https://chatgpt.com/?temporary-chat=true');
    const main = dom.window.document.querySelector('main') as HTMLElement;
    const root = dom.window.document.documentElement;
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 200 });
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(root, 'scrollWidth', { configurable: true, value: 100 });
    let top = 0;
    const render = () => {
      const suffix = top < 50 ? 'a' : 'b';
      main.innerHTML = `
        <article data-testid="conversation-turn-1" data-turn-id="turn_${suffix}">
          <div data-message-author-role="${suffix === 'a' ? 'user' : 'assistant'}">
            <div class="${suffix === 'a' ? 'whitespace-pre-wrap' : 'markdown prose'}">message-${suffix}</div>
          </div>
        </article>
      `;
    };
    render();
    Object.defineProperty(dom.window, 'scrollY', { configurable: true, get: () => top });
    Object.defineProperty(dom.window, 'scrollX', { configurable: true, get: () => 0 });
    (dom.window as any).scrollTo = (_left: number, nextTop: number) => {
      top = Number(nextTop) || 0;
      render();
    };
    const def = createChatgptCollectorDef(buildEnv(dom)) as any;

    const prepared = await def.collector.prepareManualCapture({
      maxPasses: 2,
      maxSteps: 4,
      maxOverlapRecoveries: 0,
      stableSamples: 1,
      pollMs: 0,
      stepTimeoutMs: 20,
    });

    expect(top).toBe(0);
    expect(prepared.identityVerified).toBe(true);
    expect(prepared.reasons).not.toContain('identity_changed');
    expect(prepared.records.map((record: any) => record.key)).toEqual(['turn_a:user:0', 'turn_b:assistant:0']);
  });

  it('downgrades a prepared capture when scroll restoration fails', async () => {
    const dom = setupChatgptDom(
      '<article data-testid="conversation-turn-1" data-turn-id="turn_restore"><div data-message-author-role="user"><div class="whitespace-pre-wrap">restore me</div></div></article>',
      'https://chatgpt.com/c/conv_restore_failure',
    );
    const root = dom.window.document.documentElement;
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 300 });
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(root, 'scrollWidth', { configurable: true, value: 100 });
    let top = 50;
    Object.defineProperty(dom.window, 'scrollY', { configurable: true, get: () => top });
    Object.defineProperty(dom.window, 'scrollX', { configurable: true, get: () => 0 });
    (dom.window as any).scrollTo = (_left: number, nextTop: number) => {
      if (Number(nextTop) === 50) throw new Error('restore blocked');
      top = Number(nextTop) || 0;
    };
    const def = createChatgptCollectorDef(buildEnv(dom)) as any;

    const prepared = await def.collector.prepareManualCapture({
      maxPasses: 2,
      maxSteps: 8,
      stableSamples: 1,
      pollMs: 0,
      stepTimeoutMs: 20,
    });

    expect(prepared.completeness).toBe('partial');
    expect(prepared.reasons).toContain('restore_failed');
    expect(prepared.records).toHaveLength(1);
  });

  it('returns a plain prepared object without sharing state across collector instances', async () => {
    const firstDom = loadFixtureDom();
    const secondDom = loadFixtureDom();
    (firstDom.window as any).scrollTo = vi.fn();
    (secondDom.window as any).scrollTo = vi.fn();
    mockHydrationOnDynamicScroll(firstDom);
    mockHydrationOnDynamicScroll(secondDom);
    const first = createChatgptCollectorDef(buildEnv(firstDom)) as any;
    const second = createChatgptCollectorDef(buildEnv(secondDom)) as any;

    const [firstPrepared, secondPrepared] = await Promise.all([
      first.collector.prepareManualCapture({ stepTimeoutMs: 100, pollMs: 0, stableSamples: 1 }),
      second.collector.prepareManualCapture({ stepTimeoutMs: 100, pollMs: 0, stableSamples: 1 }),
    ]);

    expect(firstPrepared).not.toBe(secondPrepared);
    expect(JSON.parse(JSON.stringify(firstPrepared))).toEqual(firstPrepared);
    expect(JSON.parse(JSON.stringify(secondPrepared))).toEqual(secondPrepared);
    firstPrepared.records[0].payload.contentText = 'mutated-first-only';
    expect(secondPrepared.records[0].payload.contentText).not.toBe('mutated-first-only');
  });

  it('rejects a prepared object after same-path temporary-chat replacement', async () => {
    const firstDom = setupChatgptDom(
      '<article data-testid="conversation-turn-1" data-turn-id="turn_first"><div data-message-author-role="user"><div class="whitespace-pre-wrap">first</div></div></article>',
      'https://chatgpt.com/?temporary-chat=true',
    );
    (firstDom.window as any).scrollTo = vi.fn();
    const first = createChatgptCollectorDef(buildEnv(firstDom)) as any;
    const prepared = await first.collector.prepareManualCapture({ stableSamples: 1, pollMs: 0 });

    const secondDom = setupChatgptDom(
      '<article data-testid="conversation-turn-1" data-turn-id="turn_second"><div data-message-author-role="user"><div class="whitespace-pre-wrap">second</div></div></article>',
      'https://chatgpt.com/?temporary-chat=true',
    );
    const second = createChatgptCollectorDef(buildEnv(secondDom)) as any;
    const snap = await second.collector.capture({ manual: true, preparedCapture: prepared });
    expect(snap).toBeNull();
  });

  it('ignores a prepared object from another conversation identity', async () => {
    const preparedDom = loadFixtureDom();
    (preparedDom.window as any).scrollTo = vi.fn();
    mockHydrationOnDynamicScroll(preparedDom);
    const preparedDef = createChatgptCollectorDef(buildEnv(preparedDom)) as any;
    const prepared = await preparedDef.collector.prepareManualCapture({
      stepTimeoutMs: 100,
      pollMs: 0,
      stableSamples: 1,
    });

    const otherDom = setupChatgptDom(
      '<div data-message-author-role="user" data-message-id="other"><div class="whitespace-pre-wrap">other</div></div>',
      'https://chatgpt.com/c/other-conversation',
    );
    const other = createChatgptCollectorDef(buildEnv(otherDom)) as any;
    const snap = await other.collector.capture({ manual: true, preparedCapture: prepared });
    expect(snap).toBeNull();
  });

  it('rejects manual capture without prepareManualCapture', async () => {
    const dom = loadFixtureDom();
    const def = createChatgptCollectorDef(buildEnv(dom)) as any;
    const snap = await def.collector.capture({ manual: true });
    expect(snap).toBeNull();
  });

  it('restores the scroll position after the sweep', async () => {
    const dom = loadFixtureDom();
    const scroll = mockHydrationOnDynamicScroll(dom);
    scroll.setPosition(0, 120);
    const def = createChatgptCollectorDef(buildEnv(dom)) as any;
    await def.collector.prepareManualCapture({ stepTimeoutMs: 100, pollMs: 0, stableSamples: 1 });
    expect(scroll.getTop()).toBe(120);
  });
});
