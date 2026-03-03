import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { ensureCollectorUtils } from '../helpers/collectors-bootstrap';

async function loadNormalize() {
  const normalizeModule = await import('../../src/shared/normalize.ts');
  const normalizeApi = normalizeModule.default || {
    normalizeText: normalizeModule.normalizeText,
    fnv1a32: normalizeModule.fnv1a32,
    makeFallbackMessageKey: normalizeModule.makeFallbackMessageKey,
  };
  const collectorContextModule = await import('../../src/collectors/collector-context.ts');
  const collectorContext = collectorContextModule.default as any;
  collectorContext.normalize = normalizeApi;
  if (!globalThis.WebClipper || typeof globalThis.WebClipper !== 'object') {
    globalThis.WebClipper = {};
  }
  globalThis.WebClipper.normalize = normalizeApi;
  return normalizeApi;
}

async function loadCollectorUtils() {
  return ensureCollectorUtils();
}

async function loadGeminiMarkdown() {
  return import('../../src/collectors/gemini/gemini-markdown.ts');
}

async function loadGoogleAiStudioCollector() {
  return import('../../src/collectors/googleaistudio/googleaistudio-collector.ts');
}

function setupDom(html: string, url: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
  // @ts-expect-error test global
  globalThis.window = dom.window;
  // @ts-expect-error test global
  globalThis.document = dom.window.document;
  // @ts-expect-error test global
  globalThis.Node = dom.window.Node;
  // @ts-expect-error test global
  globalThis.location = dom.window.location;
  return dom;
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
                <p><strong>Bold</strong> and <a href="https://example.com">link</a>.</p>
                <pre><code class="language-swift">print("hi")</code></pre>
              </div>
            </div>
          </div>
        </ms-chat-turn>
      </div>
    `;
    setupDom(html, 'https://aistudio.google.com/app/abc123');

    // @ts-expect-error test global
    if (!globalThis.WebClipper || typeof globalThis.WebClipper !== 'object') {
      globalThis.WebClipper = {};
    }
    await loadNormalize();
    await loadCollectorUtils();
    await loadGeminiMarkdown();
    await loadGoogleAiStudioCollector();

    // @ts-expect-error test global
    const snap = globalThis.WebClipper.collectors.googleaistudio.capture();
    expect(snap).toBeTruthy();
    expect(snap.conversation.source).toBe('googleaistudio');
    expect(snap.messages.length).toBe(2);
    const assistant = snap.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistant).toBeTruthy();
    expect(assistant.contentMarkdown).toContain('**Bold**');
    expect(assistant.contentMarkdown).toContain('[link](https://example.com)');
    expect(assistant.contentMarkdown).toContain('```swift');
    expect(assistant.contentMarkdown).toContain('print("hi")');
  });
});
