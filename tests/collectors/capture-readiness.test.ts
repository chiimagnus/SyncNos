import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import normalizeApi from '@services/shared/normalize.ts';
import { createCollectorEnv } from '../../src/collectors/collector-env.ts';
import { createDeepseekCollectorDef } from '../../src/collectors/deepseek/deepseek-collector.ts';
import { createDoubaoCollectorDef } from '../../src/collectors/doubao/doubao-collector.ts';
import { createGeminiCollectorDef } from '../../src/collectors/gemini/gemini-collector.ts';
import { createKimiCollectorDef } from '../../src/collectors/kimi/kimi-collector.ts';
import { createPoeCollectorDef } from '../../src/collectors/poe/poe-collector.ts';
import { createYuanbaoCollectorDef } from '../../src/collectors/yuanbao/yuanbao-collector.ts';
import { createZaiCollectorDef } from '../../src/collectors/zai/zai-collector.ts';

type Factory = (env: ReturnType<typeof createCollectorEnv>) => { collector: { getCaptureReadiness: () => string } };

function readiness(factory: Factory, url: string, html = '') {
  const dom = new JSDOM(`<body>${html}</body>`, { url });
  const env = createCollectorEnv({
    window: dom.window as any,
    document: dom.window.document as any,
    location: dom.window.location as any,
    normalize: normalizeApi,
  });
  return factory(env).collector.getCaptureReadiness();
}

const cases: Array<{ id: string; factory: Factory; url: string; unsupportedUrl: string; readyHtml: string }> = [
  {
    id: 'gemini',
    factory: createGeminiCollectorDef,
    url: 'https://gemini.google.com/app/conversation-1',
    unsupportedUrl: 'https://gemini.google.com/settings',
    readyHtml: '<div id="chat-history"><div class="conversation-container"><user-query>hello</user-query></div></div>',
  },
  {
    id: 'deepseek',
    factory: createDeepseekCollectorDef,
    url: 'https://chat.deepseek.com/a/chat/s/conversation-1',
    unsupportedUrl: 'https://chat.deepseek.com/settings',
    readyHtml: '<main><div class="_9663006"><div class="fbb737a4">hello</div></div></main>',
  },
  {
    id: 'kimi',
    factory: createKimiCollectorDef,
    url: 'https://www.kimi.com/chat/conversation-1',
    unsupportedUrl: 'https://www.kimi.com/settings',
    readyHtml:
      '<main><div class="chat-content"><div class="chat-content-item chat-content-item-user"><div class="user-content">hello</div></div></div></main>',
  },
  {
    id: 'doubao',
    factory: createDoubaoCollectorDef,
    url: 'https://www.doubao.com/chat/conversation-1',
    unsupportedUrl: 'https://www.doubao.com/settings',
    readyHtml: '<main><div data-message-id="m1"><div class="bg-g-send-msg-bubble-bg">hello</div></div></main>',
  },
  {
    id: 'yuanbao',
    factory: createYuanbaoCollectorDef,
    url: 'https://yuanbao.tencent.com/chat/a/b',
    unsupportedUrl: 'https://yuanbao.tencent.com/settings',
    readyHtml:
      '<main><div class="agent-chat__list__content"><div class="agent-chat__list__item--human"><div class="hyc-content-text">hello</div></div></div></main>',
  },
  {
    id: 'poe',
    factory: createPoeCollectorDef,
    url: 'https://poe.com/chat/conversation-1',
    unsupportedUrl: 'https://poe.com/settings',
    readyHtml:
      '<main><div class="ChatMessagesView_messageTuple__x"><div class="ChatMessage_chatMessage__x" id="message-1"><div class="Message_rightSideMessageBubble__x"><div class="Message_messageTextContainer__x">hello</div></div></div></div></main>',
  },
  {
    id: 'zai',
    factory: createZaiCollectorDef,
    url: 'https://chat.z.ai/c/conversation-1',
    unsupportedUrl: 'https://chat.z.ai/settings',
    readyHtml:
      '<main><div id="message-1" class="user-message"><div class="whitespace-pre-wrap">hello</div></div></main>',
  },
];

describe('AI collector capture readiness', () => {
  for (const item of cases) {
    it(`${item.id} waits until the current conversation has a captureable message`, () => {
      expect(readiness(item.factory, item.url)).toBe('waiting');
      expect(readiness(item.factory, item.url, item.readyHtml)).toBe('ready');
      expect(readiness(item.factory, item.unsupportedUrl)).toBe('unsupported');
    });
  }
});
