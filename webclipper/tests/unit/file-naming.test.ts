import { describe, expect, it } from 'vitest';

import { buildConversationBasename, stableConversationId10 } from '@services/conversations/domain/file-naming';

describe('file-naming', () => {
  it('generates space-free conversation basenames for Obsidian-safe files', () => {
    const convo = {
      source: 'doubao',
      title: '问候与帮助 - 豆包',
      conversationKey: 'k1',
    };

    const id10 = stableConversationId10(convo);
    const basename = buildConversationBasename(convo);

    expect(basename).toBe(`doubao-问候与帮助-豆包-${id10}`);
    expect(basename).not.toMatch(/\s/);
  });
});
