import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import normalizeApi from '../../src/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createGoogleAiStudioCollectorDef } from '../../src/collectors/googleaistudio/googleaistudio-collector.ts';

function setupDom(html: string, url: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
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

    const snap = (await Promise.resolve(createGoogleAiStudioCollectorDef(env).collector.capture())) as any;
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

    const snap = (await Promise.resolve(createGoogleAiStudioCollectorDef(env).collector.capture())) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(1);
    const user = snap.messages.find((m: { role: string }) => m.role === 'user');
    expect(user).toBeTruthy();
    expect(user.contentMarkdown).toContain('![](data:image/png;base64,');
  });
});
