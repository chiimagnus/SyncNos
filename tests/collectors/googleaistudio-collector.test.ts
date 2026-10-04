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

function virtualizedPrompt(unresolvedMarkup?: string, formulaDelayMs = 0) {
  const dom = setupDom(
    `<div id="scroll"><div class="chat-session-content">${Array.from(
      { length: 8 },
      (_, index) =>
        `<ms-chat-turn id="turn-${index}"><div data-turn-role="User"><div class="turn-content"></div></div></ms-chat-turn>`,
    ).join('')}</div></div>`,
    'https://aistudio.google.com/prompts/virtual-rendering',
  );
  const scroll = dom.window.document.querySelector('#scroll') as HTMLElement;
  const markers = Array.from(dom.window.document.querySelectorAll('[data-turn-role]')) as HTMLElement[];
  scroll.style.overflowY = 'auto';
  Object.defineProperties(scroll, {
    clientHeight: { value: 200 },
    clientWidth: { value: 100 },
    scrollHeight: { value: 800 },
    scrollWidth: { value: 100 },
  });
  scroll.getBoundingClientRect = () => new dom.window.DOMRect(0, 100, 100, 200);
  let clock = 0;
  let top = 130;
  let readyAt = 0;
  const render = () => {
    for (const [index, marker] of markers.entries()) {
      const visible = index * 100 < top + 200 && (index + 1) * 100 > top;
      const content = marker.querySelector('.turn-content') as HTMLElement;
      content.innerHTML =
        visible && clock >= readyAt
          ? index === 3 && unresolvedMarkup !== undefined
            ? unresolvedMarkup
            : index === 3 && formulaDelayMs
              ? `<div>message-${index}<ms-katex class="inline"><pre><code>${
                  clock >= readyAt + formulaDelayMs
                    ? '<span class="katex"><annotation encoding="application/x-tex">E=mc^2</annotation></span>'
                    : ''
                }</code></pre></ms-katex></div>`
              : `message-${index}`
          : '';
      for (const formula of Array.from(content.querySelectorAll('ms-katex'))) {
        formula.getBoundingClientRect = () => new dom.window.DOMRect(0, 120 + index * 100 - top, 100, 20);
      }
    }
  };
  for (const [index, marker] of markers.entries()) {
    marker.getBoundingClientRect = () => new dom.window.DOMRect(0, 100 + index * 100 - top, 100, 100);
  }
  Object.defineProperty(scroll, 'scrollTop', {
    get: () => top,
    set: (value) => {
      if (top !== Number(value)) readyAt = clock + 80;
      top = Number(value);
      render();
    },
  });
  render();
  const def = createGoogleAiStudioCollectorDef(
    createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    }),
  ) as any;
  return {
    def,
    scroll,
    now: () => clock,
    sleep: async (duration: number) => {
      clock += duration;
      render();
    },
  };
}

describe('googleaistudio-collector', () => {
  it.each(['User', 'Model'])('preserves current rich %s content without code toolbar chrome', async (role) => {
    const dom = setupDom(
      `<div class="chat-session-content"><ms-chat-turn id="current-rich"><div data-turn-role="${role}"><div class="turn-content">
        <div class="author-label">AUTHOR_META <span class="timestamp">10:11</span></div>
        <h2>Current heading</h2><p><strong>Bold</strong> and <span class="inline-code">inline_code()</span>.</p>
        <ul><li>First item</li><li>Second item</li></ul>
        <div>Inline: <ms-katex class="inline"><pre><code class="rendered"><span class="katex"><span class="katex-mathml"><annotation encoding="application/x-tex">E=mc^2</annotation></span><span class="katex-html" aria-hidden="true">DUPLICATE_MATH</span></span></code></pre></ms-katex></div>
        <ms-code-block data-test-language="ts"><mat-expansion-panel><mat-expansion-panel-header><span>TOOLBAR_META Ts</span><button>download content_copy expand_less</button></mat-expansion-panel-header>
          <pre><code class="hljs"><span>const html = '&lt;div data-x="a&amp;b"&gt;中文 😀&lt;/div&gt;';</span>\nconsole.log(html);</code></pre>
        </mat-expansion-panel></ms-code-block>
      </div></div></ms-chat-turn></div>`,
      'https://aistudio.google.com/prompts/current-rich-code',
    );
    const collector = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    );
    const snapshot = await capturePrepared(collector);
    expect(snapshot.messages).toHaveLength(1);
    const markdown = snapshot.messages[0].contentMarkdown;
    for (const text of [
      '## Current heading',
      '**Bold**',
      '`inline_code()`',
      '- First item',
      '$E=mc^2$',
      '```ts',
      '<div data-x="a&b">中文 😀</div>',
    ]) {
      expect(markdown).toContain(text);
    }
    for (const text of ['AUTHOR_META', '10:11', 'TOOLBAR_META', 'content_copy', 'DUPLICATE_MATH']) {
      expect(markdown).not.toContain(text);
    }
  });

  it('ignores unrendered thought formulas when proving final body completeness', async () => {
    const dom = setupDom(
      `<div class="chat-session-content"><ms-chat-turn id="thought-formula"><div data-turn-role="Model"><div class="turn-content"><ms-thought-chunk>private reasoning <ms-katex><pre><code></code></pre></ms-katex></ms-thought-chunk><p>Final answer</p></div></div></ms-chat-turn></div>`,
      'https://aistudio.google.com/prompts/thought-formula',
    );
    const collector = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ).collector;
    let clock = 0;
    const preparedCapture = await collector.prepareManualCapture!({
      stableSamples: 1,
      stepTimeoutMs: 1,
      pollMs: 0,
      now: () => clock,
      sleep: async () => {
        clock += 1;
      },
    });
    expect(preparedCapture.completeness).toBe('complete');
    const snapshot = await collector.capture({ manual: true, preparedCapture });
    expect(snapshot.messages.map((message: any) => message.contentMarkdown)).toEqual(['Final answer']);
  });

  it.each(['User', 'Model'])('scrolls to a lazy formula below the viewport in a long %s message', async (role) => {
    const dom = setupDom(
      `<div id="scroll"><div class="chat-session-content"><ms-chat-turn id="long-message"><div data-turn-role="${role}"><div class="turn-content">long message <ms-katex class="inline"><pre><code></code></pre></ms-katex></div></div></ms-chat-turn></div></div>`,
      'https://aistudio.google.com/prompts/lazy-formula',
    );
    const scroll = dom.window.document.querySelector('#scroll') as HTMLElement;
    const marker = dom.window.document.querySelector('[data-turn-role]') as HTMLElement;
    const formula = dom.window.document.querySelector('ms-katex') as HTMLElement;
    scroll.style.overflowY = 'auto';
    Object.defineProperties(scroll, {
      clientHeight: { value: 200 },
      clientWidth: { value: 100 },
      scrollHeight: { value: 600 },
      scrollWidth: { value: 100 },
    });
    scroll.getBoundingClientRect = () => new dom.window.DOMRect(0, 100, 100, 200);
    let top = 0;
    let clock = 0;
    let visibleAt = Number.POSITIVE_INFINITY;
    Object.defineProperty(scroll, 'scrollTop', {
      get: () => top,
      set: (value) => {
        top = Number(value);
        if (top + 200 > 500 && top < 520) visibleAt = Math.min(visibleAt, clock);
      },
    });
    marker.getBoundingClientRect = () => new dom.window.DOMRect(0, 100 - top, 100, 600);
    formula.getBoundingClientRect = () => new dom.window.DOMRect(0, 600 - top, 100, 20);
    const collector = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ).collector;
    const preparedCapture = await collector.prepareManualCapture!({
      now: () => clock,
      sleep: async (duration: number) => {
        clock += duration;
        if (clock >= visibleAt + 80) {
          formula.querySelector('code')!.innerHTML =
            '<span class="katex"><annotation encoding="application/x-tex">E=mc^2</annotation></span>';
        }
      },
    });
    expect(clock).toBeLessThan(600);
    expect(preparedCapture.completeness).toBe('complete');
    const snapshot = await collector.capture({ manual: true, preparedCapture });
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0].contentMarkdown).toContain('E=mc^2');
    expect(scroll.scrollTop).toBe(0);
  });

  it.each(['User', 'Model'])('waits for async formulas within an otherwise rendered %s message', async (role) => {
    const fixture = virtualizedPrompt(undefined, 120);
    for (const marker of Array.from(fixture.scroll.querySelectorAll('[data-turn-role]'))) {
      marker.setAttribute('data-turn-role', role);
    }
    const preparedCapture = await fixture.def.collector.prepareManualCapture({
      now: fixture.now,
      sleep: fixture.sleep,
    });
    expect({ completeness: preparedCapture.completeness, reasons: preparedCapture.reasons }).toEqual({
      completeness: 'complete',
      reasons: [],
    });
    expect(preparedCapture.records).toHaveLength(8);
    expect(preparedCapture.records[3].payload.contentMarkdown).toContain('E=mc^2');
    expect(fixture.now()).toBeLessThan(2000);
    const snapshot = await fixture.def.collector.capture({ manual: true, preparedCapture });
    expect(snapshot.messages[3].contentMarkdown).toContain('E=mc^2');
    expect(fixture.scroll.scrollTop).toBe(130);
  });

  it.each(['User', 'Model'])('does not overwrite a %s message whose formula never renders', async (role) => {
    const fixture = virtualizedPrompt(undefined, Number.POSITIVE_INFINITY);
    for (const marker of Array.from(fixture.scroll.querySelectorAll('[data-turn-role]'))) {
      marker.setAttribute('data-turn-role', role);
    }
    const preparedCapture = await fixture.def.collector.prepareManualCapture({
      now: fixture.now,
      sleep: fixture.sleep,
    });
    expect(preparedCapture.completeness).toBe('partial');
    expect(preparedCapture.reasons).toContain('unresolved_turn');
    expect(preparedCapture.records).toHaveLength(7);
    const snapshot = await fixture.def.collector.capture({ manual: true, preparedCapture });
    expect(snapshot.messages.map((message: any) => message.sequence)).toEqual([0, 1, 2, 4, 5, 6, 7]);
  });

  it('only waits for viewport hydration while retaining every offscreen slot', async () => {
    const fixture = virtualizedPrompt();
    const preparedCapture = await fixture.def.collector.prepareManualCapture({
      now: fixture.now,
      sleep: fixture.sleep,
    });
    expect(fixture.now()).toBeGreaterThanOrEqual(80);
    expect(fixture.now()).toBeLessThan(1200);
    expect(preparedCapture.completeness).toBe('complete');
    expect(preparedCapture.records).toHaveLength(8);
    const snapshot = await fixture.def.collector.capture({ manual: true, preparedCapture });
    expect(snapshot.messages.map((message: any) => message.contentMarkdown)).toEqual(
      Array.from({ length: 8 }, (_, index) => `message-${index}`),
    );
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual(
      Array.from({ length: 8 }, (_, index) => `googleaistudio:${index}:user`),
    );
    expect(fixture.scroll.scrollTop).toBe(130);
  });

  it('still waits for an empty viewport message and never marks its gap complete', async () => {
    const fixture = virtualizedPrompt('');
    const preparedCapture = await fixture.def.collector.prepareManualCapture({
      now: fixture.now,
      sleep: fixture.sleep,
    });
    expect(fixture.now()).toBeGreaterThanOrEqual(1200);
    expect(preparedCapture.completeness).toBe('partial');
    expect(preparedCapture.reasons).toContain('unresolved_turn');
    const snapshot = await fixture.def.collector.capture({ manual: true, preparedCapture });
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual(
      [0, 1, 2, 4, 5, 6, 7].map((index) => `googleaistudio:${index}:user`),
    );
  });

  it('does not wait for a permanent model error but keeps the failed slot unresolved', async () => {
    const fixture = virtualizedPrompt('<div class="model-error">An internal error has occurred.</div>');
    for (const marker of Array.from(fixture.scroll.querySelectorAll('[data-turn-role]'))) {
      marker.setAttribute('data-turn-role', 'Model');
    }
    const preparedCapture = await fixture.def.collector.prepareManualCapture({
      now: fixture.now,
      sleep: fixture.sleep,
    });
    expect(fixture.now()).toBeLessThan(1200);
    expect(preparedCapture.completeness).toBe('partial');
    expect(preparedCapture.reasons).toContain('unresolved_turn');
    expect(preparedCapture.records).toHaveLength(7);
  });

  it('preserves current cmark span italics and inline code semantics', async () => {
    const dom = setupDom(
      `<div class="chat-session-content"><ms-chat-turn id="turn-current"><div data-turn-role="Model"><div class="turn-content">
        <p><ms-cmark-node><span style="font-style: italic;"><ms-cmark-node><span>斜体</span></ms-cmark-node></span></ms-cmark-node>
        and <ms-cmark-node><span class="inline-code">inline_code()</span></ms-cmark-node>
        and <span style="font-style:normal">normal</span> and <em>native</em> and <code>literal</code>.</p>
      </div></div></ms-chat-turn></div>`,
      'https://aistudio.google.com/prompts/current-cmark',
    );
    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    );
    const snapshot = await capturePrepared(def);
    expect(snapshot.messages[0].contentMarkdown).toContain('*斜体*');
    expect(snapshot.messages[0].contentMarkdown).toContain('`inline_code()`');
    expect(snapshot.messages[0].contentMarkdown).toContain('normal');
    expect(snapshot.messages[0].contentMarkdown).toContain('*native*');
    expect(snapshot.messages[0].contentMarkdown).toContain('`literal`');
  });

  it('only marks saved AI Studio prompt routes as capture-ready', () => {
    const dom = setupDom('', 'https://aistudio.google.com/prompts/abc123');
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const def = createGoogleAiStudioCollectorDef(env);
    expect(def.collector.isCaptureAvailable()).toBe(true);

    for (const url of [
      'https://aistudio.google.com/',
      'https://aistudio.google.com/library',
      'https://aistudio.google.com/apps',
      'https://aistudio.google.com/prompts/new_chat',
      'https://aistudio.google.com/prompts/new_comparison',
      'https://aistudio.google.com/prompts/new_image',
      'https://aistudio.google.com/prompts/new_video',
      'https://aistudio.google.com/prompts/new_music',
    ]) {
      const unsupportedDom = setupDom('', url);
      const unsupportedEnv = createCollectorEnv({
        window: unsupportedDom.window as any,
        document: unsupportedDom.window.document as any,
        location: unsupportedDom.window.location as any,
        normalize: normalizeApi,
      });
      expect(createGoogleAiStudioCollectorDef(unsupportedEnv).collector.isCaptureAvailable()).toBe(false);
    }
  });

  it('uses the visible AI Studio toolbar title and ignores the browser tab title', async () => {
    const html = `
      <ms-playground-toolbar>
        <div class="page-title"><h1 class="mode-title">Visible AI Studio Title</h1></div>
      </ms-playground-toolbar>
      <div class="chat-session-content">
        <ms-chat-turn id="turn-u1"><div data-turn-role="User"><div class="turn-content">hello</div></div></ms-chat-turn>
        <ms-chat-turn id="turn-a1"><div data-turn-role="Model"><div class="turn-content">world</div></div></ms-chat-turn>
      </div>
    `;
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/title-test');
    dom.window.document.title = 'WRONG BROWSER TAB TITLE | Google AI Studio';
    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;

    const snap = (await capturePrepared(def)) as any;
    expect(snap.conversation.conversationKey).toBe('title-test');
    expect(snap.conversation.title).toBe('Visible AI Studio Title');
  });

  it('uses the saved prompt id as the durable key across AI Studio route variants', async () => {
    const html = `
      <div class="chat-session-content">
        <ms-chat-turn id="turn-route-user"><div data-turn-role="User"><div class="turn-content">hello</div></div></ms-chat-turn>
      </div>
    `;
    const captureAt = async (url: string) => {
      const dom = setupDom(html, url);
      const def = createGoogleAiStudioCollectorDef(
        createCollectorEnv({
          window: dom.window as any,
          document: dom.window.document as any,
          location: dom.window.location as any,
          normalize: normalizeApi,
        }),
      ) as any;
      return (await capturePrepared(def)) as any;
    };

    const current = await captureAt('https://aistudio.google.com/prompts/durable-prompt');
    const legacy = await captureAt('https://aistudio.google.com/u/0/prompts/durable-prompt');
    expect(current.conversation.conversationKey).toBe('durable-prompt');
    expect(legacy.conversation.conversationKey).toBe(current.conversation.conversationKey);
  });

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
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/abc123');
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const def = createGoogleAiStudioCollectorDef(env);
    expect(def.collector.isCaptureAvailable()).toBe(true);
    const snap = (await capturePrepared(def)) as any;
    expect(snap).toBeTruthy();
    expect(snap.conversation.source).toBe('googleaistudio');
    expect(snap.messages.length).toBe(2);
    const assistant = snap.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).not.toContain('SECRET_THOUGHT_SHOULD_NOT_EXPORT');
    expect(assistant.contentMarkdown).not.toContain('SECRET_THOUGHT_SHOULD_NOT_EXPORT');
    expect(assistant.contentMarkdown).not.toContain('MODEL_META_SHOULD_NOT_EXPORT');
    expect(assistant.contentMarkdown).not.toContain('MODEL_META_SHOULD_NOT_EXPORT');
    expect(assistant.contentMarkdown).not.toContain('10:11');
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
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/abc123');
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
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/abc123');
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
    const dom = setupDom('', 'https://aistudio.google.com/prompts/abc123');
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
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/abc123');
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
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/plain-input');
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
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/blob-cache');
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
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/image-policy');
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
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/abc123');
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
      'https://aistudio.google.com/prompts/a',
    );
    const secondDom = setupDom(
      '<div class="chat-session-content"><ms-chat-turn id="b"><div class="chat-turn-container user"><div data-turn-role="User"><div class="turn-content">B</div></div></div></ms-chat-turn></div>',
      'https://aistudio.google.com/prompts/b',
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
    expect(firstSnap.messages.map((message: any) => message.contentMarkdown)).toEqual(['A']);
    expect(secondSnap.messages.map((message: any) => message.contentMarkdown)).toEqual(['B']);
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

    const dom = setupDom(html, 'https://aistudio.google.com/prompts/abc123');
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
    expect(snap.messages[0]?.contentMarkdown).toBe('hello-1');
    expect(snap.messages[1]?.contentMarkdown).toBe('hello-2');
    expect(snap.messages[2]?.contentMarkdown).toBe('hello-3');
  });

  it('sweeps remounted virtual windows and restores the nested scroll root', async () => {
    const dom = setupDom(
      '<div id="scroll"><div class="chat-session-content"></div></div>',
      'https://aistudio.google.com/prompts/dynamic',
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
      maxSteps: 20,
      stableSamples: 1,
      pollMs: 0,
      sleep: async () => {},
    });
    const snap = await def.collector.capture({ manual: true, preparedCapture: prepared });
    expect(snap.messages.map((message: any) => message.contentMarkdown)).toEqual([
      'message-1',
      'message-2',
      'message-3',
      'message-4',
      'message-5',
    ]);
    expect(top).toBe(60);
    expect(left).toBe(7);
  });

  it('uses stable persisted ordinal keys even though AI Studio turn ids are runtime-only', async () => {
    const html = `<div class="chat-session-content"><ms-chat-turn id="turn-runtime-1"><div data-turn-role="User"><div class="turn-content">Q</div></div><div data-turn-role="Model"><div class="turn-content">A</div></div></ms-chat-turn></div>`;
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/identity');
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
      'turn-runtime-1:user:0',
      'turn-runtime-1:assistant:1',
    ]);
    const snapshot = await def.collector.capture({ manual: true, preparedCapture });
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'googleaistudio:0:user',
      'googleaistudio:1:assistant',
    ]);
    expect(
      snapshot.messages.every((message: any) => message.captureSequencePolicy === 'reconcile-existing-order'),
    ).toBe(true);
  });

  it('keeps persisted message keys stable when AI Studio regenerates every DOM turn id after reload', async () => {
    const captureWithRuntimeIds = async (userId: string, assistantId: string) => {
      const html = `<div class="chat-session-content">
        <ms-chat-turn id="${userId}"><div data-turn-role="User"><div class="turn-content">Q</div></div></ms-chat-turn>
        <ms-chat-turn id="${assistantId}"><div data-turn-role="Model"><div class="turn-content">A</div></div></ms-chat-turn>
      </div>`;
      const dom = setupDom(html, 'https://aistudio.google.com/prompts/reload-stability');
      const def = createGoogleAiStudioCollectorDef(
        createCollectorEnv({
          window: dom.window as any,
          document: dom.window.document as any,
          location: dom.window.location as any,
          normalize: normalizeApi,
        }),
      ) as any;
      const preparedCapture = await def.collector.prepareManualCapture();
      return def.collector.capture({ manual: true, preparedCapture });
    };

    const before = await captureWithRuntimeIds('turn-before-user', 'turn-before-assistant');
    const after = await captureWithRuntimeIds('turn-after-user', 'turn-after-assistant');
    expect(before.messages.map((message: any) => message.messageKey)).toEqual([
      'googleaistudio:0:user',
      'googleaistudio:1:assistant',
    ]);
    expect(after.messages.map((message: any) => message.messageKey)).toEqual(
      before.messages.map((message: any) => message.messageKey),
    );
  });

  it('keeps the latest assistant unresolved while the current run button is stoppable', async () => {
    const html = `<div class="chat-session-content">
      <ms-chat-turn id="turn-1">
        <div data-turn-role="User"><div class="turn-content">Q</div></div>
        <div data-turn-role="Model"><div class="turn-content">partial answer</div></div>
      </ms-chat-turn>
    </div>
    <ms-run-button><span class="stoppable-stop"></span></ms-run-button>`;
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/running');
    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    expect(def.collector.__test.isPromptRunning()).toBe(true);
    expect(def.collector.__test.readCurrentDescriptors()).toEqual([
      expect.objectContaining({ key: 'turn-1:user:0', rendered: true, streaming: false }),
      expect.objectContaining({ key: 'turn-1:assistant:1', rendered: false, streaming: true }),
    ]);

    let clock = 0;
    const prepared = await def.collector.prepareManualCapture({
      stableSamples: 1,
      pollMs: 1,
      stepTimeoutMs: 2,
      totalDeadlineMs: 20,
      now: () => clock,
      sleep: async () => {
        clock += 1;
      },
    });
    expect(prepared.completeness).toBe('partial');
    expect(prepared.reasons).toContain('unresolved_turn');
    expect(prepared.records.map((record: any) => record.key)).toEqual(['turn-1:user:0']);
  });

  it('keeps an unloaded message in a multi-message turn partial', async () => {
    const html = `<div class="chat-session-content"><ms-chat-turn id="turn-1"><div data-turn-role="User"><div class="turn-content">Q</div></div><div data-turn-role="Model"><div class="turn-content"></div></div></ms-chat-turn></div>`;
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/identity');
    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    let clock = 0;

    const preparedCapture = await def.collector.prepareManualCapture({
      stableSamples: 1,
      pollMs: 1,
      stepTimeoutMs: 2,
      now: () => clock,
      sleep: async () => {
        clock += 1;
      },
    });

    expect(preparedCapture.completeness).toBe('partial');
    expect(preparedCapture.reasons).toContain('unresolved_turn');
    expect(preparedCapture.records.map((record: any) => record.key)).toEqual(['turn-1:user:0']);
  });

  it('keeps absolute persisted slot indexes when a partial capture has an unresolved middle message', async () => {
    const html = `<div class="chat-session-content">
      <ms-chat-turn id="turn-1">
        <div data-turn-role="User"><div class="turn-content">Q1</div></div>
        <div data-turn-role="Model"><div class="turn-content"></div></div>
      </ms-chat-turn>
      <ms-chat-turn id="turn-2">
        <div data-turn-role="User"><div class="turn-content">Q2</div></div>
        <div data-turn-role="Model"><div class="turn-content">A2</div></div>
      </ms-chat-turn>
    </div>`;
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/partial-slot-order');
    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    let clock = 0;
    const preparedCapture = await def.collector.prepareManualCapture({
      stableSamples: 1,
      pollMs: 1,
      stepTimeoutMs: 2,
      totalDeadlineMs: 20,
      now: () => clock,
      sleep: async () => {
        clock += 1;
      },
    });
    expect(preparedCapture.completeness).toBe('partial');
    expect(preparedCapture.aiStudioSlotOrder).toEqual([
      'turn-1:user:0',
      'turn-1:assistant:1',
      'turn-2:user:0',
      'turn-2:assistant:1',
    ]);

    const snapshot = await def.collector.capture({ manual: true, preparedCapture });
    expect(snapshot.messages.map((message: any) => message.messageKey)).toEqual([
      'googleaistudio:0:user',
      'googleaistudio:2:user',
      'googleaistudio:3:assistant',
    ]);
    expect(snapshot.messages.map((message: any) => message.sequence)).toEqual([0, 2, 3]);
  });

  it('does not persist tail-window ordinals when the sweep never reaches the logical top', async () => {
    const dom = setupDom(
      '<div class="chat-session-content"><ms-chat-turn id="tail"><div data-turn-role="User"><div class="turn-content">tail only</div></div></ms-chat-turn></div>',
      'https://aistudio.google.com/prompts/top-timeout',
    );
    const def = createGoogleAiStudioCollectorDef(
      createCollectorEnv({
        window: dom.window as any,
        document: dom.window.document as any,
        location: dom.window.location as any,
        normalize: normalizeApi,
      }),
    ) as any;
    const preparedCapture = await def.collector.prepareManualCapture({
      stableSamples: 1,
      pollMs: 0,
      sleep: async () => {},
    });
    preparedCapture.completeness = 'partial';
    preparedCapture.metrics.reachedTop = false;
    preparedCapture.reasons.push('top_not_reached');
    expect(await def.collector.capture({ manual: true, preparedCapture })).toBeNull();
  });

  it('refuses to verify manual identity when stable turn ids are missing', async () => {
    const html = `<div class="chat-session-content"><ms-chat-turn><div data-turn-role="User"><div class="turn-content">Q</div></div></ms-chat-turn></div>`;
    const dom = setupDom(html, 'https://aistudio.google.com/prompts/missing-id');
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
