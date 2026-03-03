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
  it('captures Gemini-like DOM under aistudio.google.com', async () => {
    const html = `
      <div class="center-section">
        <div class="conversation-title-container">
          <span class="conversation-title-column">
            <span data-test-id="conversation-title" class="gds-title-m">DOM Title</span>
          </span>
        </div>
      </div>
      <div id="chat-history">
        <div class="conversation-container">
          <user-query><div class="query-text">hello</div></user-query>
          <model-response><div class="model-response-text">world</div></model-response>
        </div>
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
    expect(snap.conversation.title).toBe('DOM Title');
    expect(snap.messages.length).toBe(2);
  });
});

