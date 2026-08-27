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
          <div id="m_user" data-testid="conversation-turn" data-message-author-role="user">
            <div class="whitespace-pre-wrap">hello</div>
            <img src="https://img.test/u.png" />
          </div>
          <div id="m_ai" data-testid="conversation-turn" data-message-author-role="assistant">
            <div class="markdown">
              <p>hi</p>
              <img srcset="https://img.test/a1.png 1x, https://img.test/a2.png 2x" />
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
