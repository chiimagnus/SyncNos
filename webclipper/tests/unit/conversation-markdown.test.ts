import { describe, expect, it } from 'vitest';

import { formatConversationMarkdown } from '../../src/conversations/domain/markdown';

describe('formatConversationMarkdown (article)', () => {
  it('sanitizes htmlish/escaped article description to avoid leaking styles', () => {
    const conversation: any = {
      sourceType: 'article',
      title: 'Demo',
      url: 'https://mp.weixin.qq.com/s/hApl3qxFYs815p33KywyYg?scene=1',
      description:
        'hello\\x0a' +
        '\\x26lt;a class=\\x26quot;wx_topic_link\\x26quot; style=\\x26quot;color: #576B95 !important;\\x26quot;\\x26gt;#AdventureX\\x26lt;/a\\x26gt;' +
        '\\x26amp;nbsp;tail',
    };
    const messages: any[] = [{ contentMarkdown: 'body' }];

    const out = formatConversationMarkdown(conversation, messages);

    expect(out).toContain('- Description:');
    expect(out).toContain('#AdventureX');
    expect(out).toContain('hello #AdventureX tail');
    expect(out).not.toContain('wx_topic_link');
    expect(out).not.toContain('style=');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('\\x26');
  });
});
