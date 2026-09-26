import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createChatgptCollectorDef } from '../../src/collectors/chatgpt/chatgpt-collector.ts';
import { createZaiCollectorDef } from '../../src/collectors/zai/zai-collector.ts';

describe('collectors images (smoke)', () => {
  it('chatgpt collector appends image markdown', async () => {
    const dom = new JSDOM(
      `<body>
        <main>
          <div data-turn-key="turn-1">
            <div data-content-search-turn-key="fallback-turn-0">
              <div
                data-chatgpt-search-unit-key="fallback-turn-0:0:user"
                data-chatgpt-search-message-ids="user-1"
                data-is-intersecting="true"
              >
                <div data-user-message-bubble="true"><div class="whitespace-pre-wrap">hello</div></div>
                <img src="https://img.test/u.png" />
              </div>
              <div
                data-chatgpt-search-unit-key="fallback-turn-0:2:assistant"
                data-chatgpt-search-message-ids="assistant-1"
                data-is-intersecting="true"
              >
                <div data-chatgpt-selection-message-id="assistant-1">
                  <div data-markdown-text-style="assistant-message" data-markdown-text-tone="primary">
                    <p>hi</p>
                    <img srcset="https://img.test/a1.png 1x, https://img.test/a2.png 2x" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </body>`,
      { url: 'https://chatgpt.com/c/conv1' },
    );
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const collector = createChatgptCollectorDef(env).collector;
    const preparedCapture = await collector.prepareManualCapture({
      maxSteps: 1,
      stableSamples: 1,
      pollMs: 0,
    });
    const snap = (await collector.capture({ manual: true, preparedCapture })) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    expect(snap.messages[0].contentMarkdown).toContain('![](https://img.test/u.png)');
    expect(snap.messages[1].contentMarkdown).toContain('![](https://img.test/a2.png)');
  });

  it('z.ai collector appends image markdown', async () => {
    const dom = new JSDOM(
      `<body>
        <main>
          <div id="message-1" class="user-message">
            <div class="whitespace-pre-wrap">
              user
              <img src="https://img.test/z-user.png" />
            </div>
          </div>
          <div id="message-2">
            <div class="chat-assistant">
              <div id="response-content-container">
                <div class="markdown-prose">
                  <p>assistant</p>
                  <img src="https://img.test/z-ai.png" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </body>`,
      { url: 'https://chat.z.ai/c/conv1' },
    );
    const env = createCollectorEnv({
      window: dom.window as any,
      document: dom.window.document as any,
      location: dom.window.location as any,
      normalize: normalizeApi,
    });
    const snap = createZaiCollectorDef(env).collector.capture({ manual: true }) as any;
    expect(snap).toBeTruthy();
    expect(snap.messages.length).toBe(2);
    expect(snap.messages[0].contentMarkdown).toContain('![](https://img.test/z-user.png)');
    expect(snap.messages[1].contentMarkdown).toContain('![](https://img.test/z-ai.png)');
  });
});
