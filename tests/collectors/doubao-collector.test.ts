import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createDoubaoCollectorDef } from '../../src/collectors/doubao/doubao-collector.ts';

function setupDoubaoDom(html: string, url: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
  return dom;
}

describe('doubao-collector', () => {
  it('extracts messages from modern data-message-id DOM structure', async () => {
    const html = `
      <div aria-label="doc_editor">
        <div class="container-PvPoAn">
          <div class="flex flex-col flex-grow">
            <div data-message-id="43080634158254594" class="flex-row flex w-full justify-end">
              <div class="bg-g-send-msg-bubble-bg">111</div>
            </div>
            <div data-foundation-type="send-message-action-bar"></div>
          </div>
        </div>
        <div class="container-PvPoAn">
          <div data-copy-telemetry="right_click_copy" class="flex flex-col flex-grow">
            <div data-message-id="43080634158259458" class="relative flex-row flex w-full">
              <div class="flow-markdown-body">
                <div class="paragraph-pP9ZLC paragraph-element">111～👀</div>
              </div>
            </div>
            <div data-foundation-type="receive-message-action-bar"></div>
          </div>
        </div>
      </div>
      <textarea id="composer"></textarea>
    `;

    const dom = setupDoubaoDom(html, 'https://www.doubao.com/chat/conv-modern-001');
    const textarea = dom.window.document.getElementById('composer') as HTMLTextAreaElement | null;
    textarea?.focus();

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const snap = (await Promise.resolve(createDoubaoCollectorDef(env).collector.capture())) as any;

    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    expect(snap.messages[0].role).toBe('user');
    expect(snap.messages[0].contentMarkdown).toBe('111');
    expect(snap.messages[1].role).toBe('assistant');
    expect(snap.messages[1].contentMarkdown).toBe('111～👀');
    expect(snap.messages[1].contentMarkdown).toContain('111～👀');
  });

  it('falls back to plain text markdown when markdown helper is unavailable', async () => {
    const html = `
      <div aria-label="doc_editor">
        <div class="container-PvPoAn">
          <div data-copy-telemetry="right_click_copy" class="flex flex-col flex-grow">
            <div data-message-id="43080634158259458" class="relative flex-row flex w-full">
              <div data-testid="message_text_content">plain answer</div>
            </div>
            <div data-foundation-type="receive-message-action-bar"></div>
          </div>
        </div>
      </div>
    `;

    vi.resetModules();
    vi.doMock('../../src/collectors/doubao/doubao-markdown.ts', () => ({ default: {} }));

    const dom = setupDoubaoDom(html, 'https://www.doubao.com/chat/fallback001');
    const { createDoubaoCollectorDef: createDef } = await import('../../src/collectors/doubao/doubao-collector.ts');
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const snap = (await Promise.resolve(createDef(env).collector.capture())) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    expect(snap.messages[0].role).toBe('assistant');
    expect(snap.messages[0].contentMarkdown).toBe('plain answer');
    expect(snap.messages[0].contentMarkdown).toBe('plain answer');
  });

  it('inlines blob: uploaded images as data:image urls', async () => {
    const blobUrl = 'blob:https://www.doubao.com/ee26c19d-9884-4cd8-8bcf-6b7ba6436f0f';
    const data = new Uint8Array([0, 1, 2, 3, 4, 5]);

    const html = `
      <div aria-label="doc_editor">
        <div class="container-PvPoAn">
          <div class="flex flex-col flex-grow">
            <div data-message-id="43080634158254594" class="flex-row flex w-full justify-end">
              <div class="bg-g-send-msg-bubble-bg">
                <div data-testid="message_text_content">解释图片</div>
                <img decoding="async" width="1080" height="1352" src="${blobUrl}">
              </div>
            </div>
            <div data-foundation-type="send-message-action-bar"></div>
          </div>
        </div>
        <div class="container-PvPoAn">
          <div data-copy-telemetry="right_click_copy" class="flex flex-col flex-grow">
            <div data-message-id="43080634158259458" class="relative flex-row flex w-full">
              <div data-testid="message_text_content">好的</div>
            </div>
            <div data-foundation-type="receive-message-action-bar"></div>
          </div>
        </div>
      </div>
    `;

    const dom = setupDoubaoDom(html, 'https://www.doubao.com/chat/blob001');
    (dom.window as any).fetch = vi.fn(async (url: string) => {
      if (url !== blobUrl) return { ok: false, blob: async () => new dom.window.Blob() };
      return {
        ok: true,
        blob: async () => new dom.window.Blob([data], { type: 'image/png' }),
      };
    });

    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });

    const snap = (await Promise.resolve(createDoubaoCollectorDef(env).collector.capture())) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    const user = snap.messages.find((m: { role: string }) => m.role === 'user');
    expect(user).toBeTruthy();
    expect(user.contentMarkdown).toContain('![](data:image/png');
  });
});
