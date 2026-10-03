import { describe, expect, it } from 'vitest';

import { canonicalChatIdentityFromUrl } from '@services/conversations/domain/chat-identity';

describe('canonical chat identity', () => {
  it.each([
    ['chatgpt', 'https://chatgpt.com/c/abc-1?x=1', 'chatgpt:conversation:abc-1'],
    ['chatgpt', 'https://chatgpt.com/g/project/c/abc-2', 'chatgpt:conversation:abc-2'],
    ['chatgpt', 'https://chatgpt.com/share/share-1', 'chatgpt:share:share-1'],
    ['claude', 'https://claude.ai/chat/claude-1', 'claude:claude-1'],
    ['gemini', 'https://gemini.google.com/app/gemini-1?hl=zh', 'gemini:gemini-1'],
    ['googleaistudio', 'https://aistudio.google.com/u/0/prompts/prompt-1', 'googleaistudio:prompt-1'],
    ['deepseek', 'https://chat.deepseek.com/a/chat/s/deep-1', 'deepseek:deep-1'],
    ['kimi', 'https://www.kimi.com/chat/kimi-1?chat_enter_method=home', 'kimi:kimi-1'],
    ['doubao', 'https://www.doubao.com/chat/doubao-1?from=history', 'doubao:doubao-1'],
    ['yuanbao', 'https://yuanbao.tencent.com/chat/agent-1/conversation-1', 'yuanbao:conversation-1'],
    ['poe', 'https://poe.com/chat/poe-1', 'poe:poe-1'],
    ['notionai', 'https://app.notion.com/chat?t=ABCDEF&wfv=chat', 'notionai:abcdef'],
    ['zai', 'https://chat.z.ai/c/zai-1', 'zai:zai-1'],
  ])('derives %s durable identity from its real conversation route', (source, url, expected) => {
    expect(canonicalChatIdentityFromUrl(source, url)).toBe(expected);
  });

  it('normalizes provider aliases and ignores non-durable home/new-chat routes', () => {
    expect(canonicalChatIdentityFromUrl('kimi', 'https://kimi.moonshot.cn/chat/kimi-1')).toBe('kimi:kimi-1');
    expect(canonicalChatIdentityFromUrl('googleaistudio', 'https://makersuite.google.com/app/prompts/prompt-1')).toBe(
      'googleaistudio:prompt-1',
    );
    expect(canonicalChatIdentityFromUrl('gemini', 'https://gemini.google.com/app')).toBe('');
    expect(canonicalChatIdentityFromUrl('yuanbao', 'https://yuanbao.tencent.com/chat/agent-1')).toBe('');
    expect(canonicalChatIdentityFromUrl('googleaistudio', 'https://aistudio.google.com/prompts/new_chat')).toBe('');
    expect(canonicalChatIdentityFromUrl('unknown', 'https://example.com/chat/1')).toBe('');
  });
});
