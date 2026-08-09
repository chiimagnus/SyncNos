import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createZaiCollectorDef } from '../../src/collectors/zai/zai-collector.ts';

describe('collectors images (smoke)', () => {
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
