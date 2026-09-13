import { describe, expect, it } from 'vitest';

import {
  isCanonicalChatgptHostname,
  isCanonicalChatgptOrigin,
  parseChatgptDurableConversationRoute,
} from '@services/shared/chatgpt-route';

describe('ChatGPT canonical route', () => {
  it('accepts only the canonical hostname and origin', () => {
    expect(isCanonicalChatgptHostname('chatgpt.com')).toBe(true);
    expect(isCanonicalChatgptHostname('CHATGPT.COM')).toBe(true);
    expect(isCanonicalChatgptHostname('www.chatgpt.com')).toBe(false);
    expect(isCanonicalChatgptHostname('foo.chatgpt.com')).toBe(false);
    expect(isCanonicalChatgptHostname('chat.openai.com')).toBe(false);

    expect(isCanonicalChatgptOrigin('https://chatgpt.com')).toBe(true);
    expect(isCanonicalChatgptOrigin('https://www.chatgpt.com')).toBe(false);
    expect(isCanonicalChatgptOrigin('http://chatgpt.com')).toBe(false);
    expect(isCanonicalChatgptOrigin('https://chatgpt.com:443')).toBe(false);
  });

  it('parses only durable canonical conversation routes', () => {
    expect(parseChatgptDurableConversationRoute('https://chatgpt.com/c/conv-1')).toEqual({ conversationId: 'conv-1' });
    expect(parseChatgptDurableConversationRoute('https://chatgpt.com/c/conv-1/?model=x#tail')).toEqual({
      conversationId: 'conv-1',
    });
    expect(parseChatgptDurableConversationRoute('https://chatgpt.com/g/project-slug/c/conv-2')).toEqual({
      conversationId: 'conv-2',
    });

    for (const url of [
      'https://www.chatgpt.com/c/conv-1',
      'https://foo.chatgpt.com/c/conv-1',
      'https://chat.openai.com/c/conv-1',
      'http://chatgpt.com/c/conv-1',
      'https://chatgpt.com/share/share-1',
      'https://chatgpt.com/?temporary-chat=true',
      'https://chatgpt.com/',
      'https://chatgpt.com/g/project-slug',
    ]) {
      expect(parseChatgptDurableConversationRoute(url)).toBeNull();
    }
  });
});
