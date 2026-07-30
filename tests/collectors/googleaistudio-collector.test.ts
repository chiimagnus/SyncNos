import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createGoogleAiStudioCollectorDef } from '../../src/collectors/googleaistudio/googleaistudio-collector.ts';

function setupDom(html: string, url: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
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

describe('googleaistudio-collector', () => {
  it('captures AI Studio ms-chat-turn DOM and renders assistant markdown', async () => {
    const html = `
      <div class="chat-session-content">
        <ms-chat-turn id="turn-u1">
          <div class="chat-turn-container render user">
            <div class="virtual-scroll-container user-prompt-container" data-turn-role="User">
              <div class="turn-content">hello</div>
            </div>
          </div>
        </ms-chat-turn>
        <ms-chat-turn id="turn-a1">
          <div class="chat-turn-container render model">
            <div class="virtual-scroll-container model-prompt-container" data-turn-role="Model">
              <div class="turn-content">
                <div role="heading" aria-level="3" class="author-label">
                  MODEL_META_SHOULD_NOT_EXPORT <span class="timestamp">10:11</span>
                </div>
                <ms-thought-chunk>
                  <div class="thought-panel">
                    <p>SECRET_THOUGHT_SHOULD_NOT_EXPORT</p>
                  </div>
                </ms-thought-chunk>
                <p><strong>Bold</strong> and <a href="https://example.com">link</a>.</p>
                <pre><code class="language-swift">print("hi")</code></pre>
              </div>
            </div>
          </div>
        </ms-chat-turn>
      </div>
    `;
    const dom = setupDom(html, 'https://aistudio.google.com/app/abc123');
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await capturePrepared(createGoogleAiStudioCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    expect(snap.conversation.source).toBe('googleaistudio');
    expect(snap.messages.length).toBe(2);
    const assistant = snap.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant).toBeTruthy();
    expect(assistant.contentText).not.toContain('SECRET_THOUGHT_SHOULD_NOT_EXPORT');
    expect(assistant.contentMarkdown).not.toContain('SECRET_THOUGHT_SHOULD_NOT_EXPORT');
    expect(assistant.contentText).not.toContain('MODEL_META_SHOULD_NOT_EXPORT');
    expect(assistant.contentMarkdown).not.toContain('MODEL_META_SHOULD_NOT_EXPORT');
    expect(assistant.contentText).not.toContain('10:11');
    expect(assistant.contentMarkdown).not.toContain('10:11');
    expect(assistant.contentMarkdown).toContain('**Bold**');
    expect(assistant.contentMarkdown).toContain('[link](https://example.com)');
    expect(assistant.contentMarkdown).toContain('```swift');
    expect(assistant.contentMarkdown).toContain('print("hi")');
  });

  it('captures list items wrapped by ms-cmark-node in assistant markdown', async () => {
    const html = `
      <div class="chat-session-content">
        <ms-chat-turn id="turn-a1">
          <div class="chat-turn-container render model">
            <div class="virtual-scroll-container model-prompt-container" data-turn-role="Model">
              <div class="turn-content">
                <h2>1. 论文标题和摘要</h2>
                <ul>
                  <ms-cmark-node class="cmark-node v3-font-body">
                    <li>
                      <p>
                        <ms-cmark-node>
                          <strong><ms-cmark-node><span>研究对象</span></ms-cmark-node></strong>
                          <span>：全尺寸双足人形机器人（以 CASIA Q5 为验证平台）。</span>
                        </ms-cmark-node>
                      </p>
                    </li>
                    <li>
                      <p>
                        <ms-cmark-node>
                          <strong><ms-cmark-node><span>核心问题</span></ms-cmark-node></strong>
                          <span>：在未知且动态变化的外部负载下如何稳定控制。</span>
                        </ms-cmark-node>
                      </p>
                    </li>
                  </ms-cmark-node>
                </ul>
                <h2>2. 引言 (Introduction)</h2>
              </div>
            </div>
          </div>
        </ms-chat-turn>
      </div>
    `;
    const dom = setupDom(html, 'https://aistudio.google.com/app/abc123');
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await capturePrepared(createGoogleAiStudioCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    const assistant = snap.messages[0];
    expect(assistant.role).toBe('assistant');
    expect(assistant.contentMarkdown).toContain('## 1. 论文标题和摘要');
    expect(assistant.contentMarkdown).toContain('研究对象');
    expect(assistant.contentMarkdown).toContain('CASIA Q5');
    expect(assistant.contentMarkdown).toContain('核心问题');
    expect(assistant.contentMarkdown).toContain('稳定控制');
  });

  it('does not wrap KaTeX formulas in code fences when they are inside pre>code', async () => {
    const html = `
      <div class="chat-session-content">
        <ms-chat-turn id="turn-a1">
          <div class="chat-turn-container render model">
            <div class="virtual-scroll-container model-prompt-container" data-turn-role="Model">
              <div class="turn-content">
                <pre>
                  <code>
                    <span class="katex-display">
                      <annotation encoding="application/x-tex">e^{i\\pi}+1=0</annotation>
                    </span>
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </ms-chat-turn>
      </div>
    `;
    const dom = setupDom(html, 'https://aistudio.google.com/app/abc123');
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await capturePrepared(createGoogleAiStudioCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    const assistant = snap.messages[0];
    expect(assistant.role).toBe('assistant');
    expect(assistant.contentMarkdown).toContain('$$e^{i\\pi}+1=0$$');
    expect(assistant.contentMarkdown).not.toContain('```');
  });

  it('keeps ms-katex inline formulas inline (no forced line breaks)', async () => {
    const dom = setupDom('', 'https://aistudio.google.com/app/abc123');
    const d = dom.window.document;

    const session = d.createElement('div');
    session.className = 'chat-session-content';
    d.body.appendChild(session);

    const turn = d.createElement('ms-chat-turn');
    turn.setAttribute('id', 'turn-a1');
    session.appendChild(turn);

    const turnContainer = d.createElement('div');
    turnContainer.className = 'chat-turn-container render model';
    turn.appendChild(turnContainer);

    const vs = d.createElement('div');
    vs.className = 'virtual-scroll-container model-prompt-container';
    vs.setAttribute('data-turn-role', 'Model');
    turnContainer.appendChild(vs);

    const content = d.createElement('div');
    content.className = 'turn-content';
    vs.appendChild(content);

    const ul = d.createElement('ul');
    const li = d.createElement('li');
    const p = d.createElement('p');
    const strong = d.createElement('strong');

    function createInlineKatex(tex: string) {
      const msKatex = d.createElement('ms-katex');
      msKatex.className = 'inline';
      const pre = d.createElement('pre');
      const code = d.createElement('code');
      code.className = 'rendered';
      const spanKatex = d.createElement('span');
      spanKatex.className = 'katex';
      const spanMathml = d.createElement('span');
      spanMathml.className = 'katex-mathml';
      const ann = d.createElement('annotation');
      ann.setAttribute('encoding', 'application/x-tex');
      ann.textContent = tex;
      spanMathml.appendChild(ann);
      spanKatex.appendChild(spanMathml);
      code.appendChild(spanKatex);
      pre.appendChild(code);
      msKatex.appendChild(pre);
      return msKatex;
    }

    strong.appendChild(createInlineKatex('e'));
    const span1 = d.createElement('span');
    span1.textContent = ' (自然对数的底数)';
    strong.appendChild(span1);

    p.appendChild(strong);
    const text1 = d.createElement('span');
    text1.textContent = '：状态转移矩阵（';
    p.appendChild(text1);
    p.appendChild(createInlineKatex('e^{At}'));
    const text2 = d.createElement('span');
    text2.textContent = '）的物理基石。';
    p.appendChild(text2);

    li.appendChild(p);
    ul.appendChild(li);
    content.appendChild(ul);

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await capturePrepared(createGoogleAiStudioCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    const assistant = snap.messages[0];
    expect(assistant.role).toBe('assistant');
    expect(assistant.contentMarkdown).toContain('$e$');
    expect(assistant.contentMarkdown).toContain('$e^{At}$');
    expect(assistant.contentMarkdown).not.toContain('$$e$$');
    expect(assistant.contentMarkdown).not.toContain('$$e^{At}$$');
    expect(assistant.contentMarkdown).not.toContain('```');
  });

  it('inlines blob: image urls as data: urls', async () => {
    const html = `
      <div class="chat-session-content">
        <ms-chat-turn id="turn-u1">
          <div class="chat-turn-container render user">
            <div class="virtual-scroll-container user-prompt-container" data-turn-role="User">
              <div class="turn-content">
                hello
                <img alt="image.png" src="blob:https://aistudio.google.com/fake-blob-id" />
              </div>
            </div>
          </div>
        </ms-chat-turn>
      </div>
    `;
    const dom = setupDom(html, 'https://aistudio.google.com/app/abc123');
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG signature
    const pngBlob = new (dom.window as any).Blob([pngBytes], { type: 'image/png' });

    (dom.window as any).fetch = async () => ({
      ok: true,
      blob: async () => pngBlob,
    });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await capturePrepared(createGoogleAiStudioCollectorDef(env))) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    const user = snap.messages.find((m: { role: string }) => m.role === 'user');
    expect(user).toBeTruthy();
    expect(user.contentMarkdown).toContain('![](data:image/png;base64,');
  });

  it('finishes asynchronous image extraction from plain snapshots after the live DOM is replaced', async () => {
    const html = `<div class="chat-session-content">
      <ms-chat-turn id="turn-1"><div data-turn-role="User"><div class="turn-content">one<img src="blob:https://aistudio.google.com/one" /></div></div></ms-chat-turn>
      <ms-chat-turn id="turn-2"><div data-turn-role="User"><div class="turn-content">two<img src="blob:https://aistudio.google.com/two" /></div></div></ms-chat-turn>
    </div>`;
    const dom = setupDom(html, 'https://aistudio.google.com/app/plain-input');
    let releaseFirst: (() => void) | null = null;
    let calls = 0;
    (dom.window as any).fetch = async () => {
      calls += 1;
      if (calls === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
      return {
        ok: true,
        blob: async () => new (dom.window as any).Blob([new Uint8Array([1])], { type: 'image/png' }),
      };
    };
    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    const preparing = def.collector.prepareManualCapture({ stableSamples: 1, pollMs: 0, sleep: async () => {} });
    while (!releaseFirst) await Promise.resolve();
    dom.window.document.querySelector('.chat-session-content')!.innerHTML = '<p>replaced</p>';
    releaseFirst();
    const prepared = await preparing;
    expect(prepared.records).toEqual([]);
    expect(prepared.reasons).toContain('identity_changed');
    expect(await def.collector.capture({ manual: true, preparedCapture: prepared })).toBeNull();
    expect(calls).toBe(2);
  });

  it('extracts each unchanged blob reference once per capture, including failed references', async () => {
    const shared = 'blob:https://aistudio.google.com/shared';
    const html = `<div class="chat-session-content">
      <ms-chat-turn id="turn-1"><div data-turn-role="User"><div class="turn-content">one<img src="${shared}" /></div></div></ms-chat-turn>
      <ms-chat-turn id="turn-2"><div data-turn-role="Model"><div class="turn-content">two<img src="${shared}" /></div></div></ms-chat-turn>
    </div>`;
    const dom = setupDom(html, 'https://aistudio.google.com/app/blob-cache');
    let calls = 0;
    (dom.window as any).fetch = async () => {
      calls += 1;
      return { ok: false };
    };
    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    const snap = await capturePrepared(def);
    expect(snap.messages).toHaveLength(2);
    expect(calls).toBe(1);
    expect(snap.conversation.warningFlags).toContain('inline_images_fetch_failed');
  });

  it('protects only messages whose blob images could not be inlined', async () => {
    const html = `<div class="chat-session-content">
      <ms-chat-turn id="turn-1"><div data-turn-role="User"><div class="turn-content">failed<img src="blob:https://aistudio.google.com/fail" /></div></div></ms-chat-turn>
      <ms-chat-turn id="turn-2"><div data-turn-role="Model"><div class="turn-content">ok<img src="blob:https://aistudio.google.com/ok" /></div></div></ms-chat-turn>
    </div>`;
    const dom = setupDom(html, 'https://aistudio.google.com/app/image-policy');
    (dom.window as any).fetch = async (url: string) =>
      url.endsWith('/fail')
        ? { ok: false }
        : {
            ok: true,
            blob: async () => new (dom.window as any).Blob([new Uint8Array([1])], { type: 'image/png' }),
          };
    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    const prepared = await def.collector.prepareManualCapture({ stableSamples: 1, pollMs: 0, sleep: async () => {} });
    const snap = await def.collector.capture({ manual: true, preparedCapture: prepared });
    expect(snap.captureMeta.completeness).toBe('partial');
    expect(snap.captureMeta.reasons).toContain('inline_images_incomplete');
    expect(snap.messages[0].captureMergePolicy).toBe('preserve-existing-markdown');
    expect(snap.messages[1].captureMergePolicy).toBeUndefined();
    expect(snap.messages[1].contentMarkdown).toContain('data:image/png;base64,');
  });

  it('preserves inline image warningFlags in manual capture flow', async () => {
    const html = `
      <div class="chat-session-content">
        <ms-chat-turn id="turn-u1">
          <div class="chat-turn-container render user">
            <div class="virtual-scroll-container user-prompt-container" data-turn-role="User">
              <div class="turn-content">
                hello
                <img alt="image.png" src="blob:https://aistudio.google.com/too-large" />
              </div>
            </div>
          </div>
        </ms-chat-turn>
      </div>
    `;
    const dom = setupDom(html, 'https://aistudio.google.com/app/abc123');
    (dom.window as any).fetch = async () => ({
      ok: false,
      blob: async () => new (dom.window as any).Blob([], { type: 'image/png' }),
    });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const def = createGoogleAiStudioCollectorDef(env) as any;
    const preparedCapture = await Promise.resolve(def.collector.prepareManualCapture());
    const snap = (await Promise.resolve(def.collector.capture({ manual: true, preparedCapture }))) as any;
    expect(snap).toBeTruthy();
    expect(Array.isArray(snap.conversation.warningFlags)).toBe(true);
    expect(snap.conversation.warningFlags).toContain('inline_images_fetch_failed');
  });

  it('keeps prepared results isolated across collector instances', async () => {
    const firstDom = setupDom(
      '<div class="chat-session-content"><ms-chat-turn id="a"><div class="chat-turn-container user"><div data-turn-role="User"><div class="turn-content">A</div></div></div></ms-chat-turn></div>',
      'https://aistudio.google.com/app/a',
    );
    const secondDom = setupDom(
      '<div class="chat-session-content"><ms-chat-turn id="b"><div class="chat-turn-container user"><div data-turn-role="User"><div class="turn-content">B</div></div></div></ms-chat-turn></div>',
      'https://aistudio.google.com/app/b',
    );
    const first = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: firstDom.window as any,
        document: firstDom.window.document as any,
        location: firstDom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    const second = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: secondDom.window as any,
        document: secondDom.window.document as any,
        location: secondDom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    const [a, b] = await Promise.all([first.collector.prepareManualCapture(), second.collector.prepareManualCapture()]);
    const firstSnap = await first.collector.capture({ manual: true, preparedCapture: a });
    const secondSnap = await second.collector.capture({ manual: true, preparedCapture: b });
    expect(firstSnap.messages.map((message: any) => message.contentText)).toEqual(['A']);
    expect(secondSnap.messages.map((message: any) => message.contentText)).toEqual(['B']);
  });

  it('manual capture keeps full turn list', async () => {
    const html = `
      <div class="chat-session-content">
        <ms-chat-turn id="turn-u1">
          <div class="chat-turn-container render user">
            <div class="virtual-scroll-container user-prompt-container" data-turn-role="User">
              <div class="turn-content">hello-1</div>
            </div>
          </div>
        </ms-chat-turn>
        <ms-chat-turn id="turn-u2">
          <div class="chat-turn-container render user">
            <div class="virtual-scroll-container user-prompt-container" data-turn-role="User">
              <div class="turn-content">hello-2</div>
            </div>
          </div>
        </ms-chat-turn>
        <ms-chat-turn id="turn-u3">
          <div class="chat-turn-container render user">
            <div class="virtual-scroll-container user-prompt-container" data-turn-role="User">
              <div class="turn-content">hello-3</div>
            </div>
          </div>
        </ms-chat-turn>
      </div>
    `;

    const dom = setupDom(html, 'https://aistudio.google.com/app/abc123');
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const def = createGoogleAiStudioCollectorDef(env) as any;
    const preparedCapture = await Promise.resolve(def.collector.prepareManualCapture());
    const snap = (await Promise.resolve(def.collector.capture({ manual: true, preparedCapture }))) as any;

    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(3);
    expect(snap.messages[0]?.contentText).toBe('hello-1');
    expect(snap.messages[1]?.contentText).toBe('hello-2');
    expect(snap.messages[2]?.contentText).toBe('hello-3');
  });

  it('sweeps remounted virtual windows and restores the nested scroll root', async () => {
    const dom = setupDom(
      '<div id="scroll"><div class="chat-session-content"></div></div>',
      'https://aistudio.google.com/app/dynamic',
    );
    const document = dom.window.document;
    const scroll = document.querySelector('#scroll') as HTMLElement;
    const session = document.querySelector('.chat-session-content') as HTMLElement;
    scroll.style.overflowY = 'auto';
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 100 },
      clientWidth: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 140 },
    });
    let top = 60;
    let left = 7;
    const render = () => {
      const ids = top < 75 ? [1, 2] : top < 175 ? [2, 3, 4] : [4, 5];
      session.innerHTML = ids
        .map(
          (id) =>
            `<ms-chat-turn id="turn-${id}"><div data-turn-role="User"><div class="turn-content">message-${id}</div></div></ms-chat-turn>`,
        )
        .join('');
    };
    Object.defineProperty(scroll, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value) => {
        top = Number(value);
        render();
      },
    });
    Object.defineProperty(scroll, 'scrollLeft', {
      configurable: true,
      get: () => left,
      set: (value) => {
        left = Number(value);
      },
    });
    render();

    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    const prepared = await def.collector.prepareManualCapture({
      maxPasses: 3,
      maxSteps: 20,
      stableSamples: 1,
      pollMs: 0,
      sleep: async () => {},
    });
    const snap = await def.collector.capture({ manual: true, preparedCapture: prepared });
    expect(snap.messages.map((message: any) => message.contentText)).toEqual([
      'message-1',
      'message-2',
      'message-3',
      'message-4',
      'message-5',
    ]);
    expect(top).toBe(60);
    expect(left).toBe(7);
  });

  it('uses stable turn-role-ordinal keys for multiple messages in one turn', async () => {
    const html = `<div class="chat-session-content"><ms-chat-turn id="turn-1"><div data-turn-role="User"><div class="turn-content">Q</div></div><div data-turn-role="Model"><div class="turn-content">A</div></div></ms-chat-turn></div>`;
    const dom = setupDom(html, 'https://aistudio.google.com/app/identity');
    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    const preparedCapture = await def.collector.prepareManualCapture();
    expect(preparedCapture.records.map((record: any) => record.payload.messageKey)).toEqual([
      'turn-1:user:0',
      'turn-1:assistant:1',
    ]);
    expect(
      preparedCapture.records.every((record: any) => !String(record.payload.messageKey).startsWith('fallback_')),
    ).toBe(true);
  });

  it('refuses to verify manual identity when stable turn ids are missing', async () => {
    const html = `<div class="chat-session-content"><ms-chat-turn><div data-turn-role="User"><div class="turn-content">Q</div></div></ms-chat-turn></div>`;
    const dom = setupDom(html, 'https://aistudio.google.com/app/missing-id');
    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    const preparedCapture = await def.collector.prepareManualCapture();
    expect(preparedCapture.identityVerified).toBe(false);
    expect(preparedCapture.conversationKey).toBe('');
    expect(preparedCapture.records).toEqual([]);
    const snap = await def.collector.capture({ manual: true, preparedCapture });
    expect(snap).toBeNull();
  });
});
