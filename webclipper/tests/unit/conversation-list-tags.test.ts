import { describe, expect, it } from 'vitest';

import { resolveConversationListTag } from '@ui/conversations/conversation-list-tags';

function tr(key: string): string {
  return key;
}

describe('resolveConversationListTag', () => {
  it('for web uses listSiteKey domain label first', () => {
    const result = resolveConversationListTag({
      conversation: {
        source: 'web',
        listSourceKey: 'web',
        listSiteKey: 'domain:example.com',
        url: 'https://fallback.example.org/article',
      },
      translate: tr,
    });

    expect(result.sourceKey).toBe('web');
    expect(result.label).toBe('example.com');
  });

  it('for web falls back to parsed hostname when listSiteKey is unknown or missing', () => {
    const fromUnknownSiteKey = resolveConversationListTag({
      conversation: {
        source: 'web',
        listSourceKey: 'web',
        listSiteKey: 'unknown',
        url: 'https://docs.syncnos.example/path?x=1',
      },
      translate: tr,
    });
    expect(fromUnknownSiteKey.label).toBe('docs.syncnos.example');

    const fromMissingSiteKey = resolveConversationListTag({
      conversation: {
        source: 'web',
        listSourceKey: 'web',
        url: 'https://another.example.com/chat',
      },
      translate: tr,
    });
    expect(fromMissingSiteKey.label).toBe('another.example.com');
  });

  it('for web returns insightUnknownLabel when no domain can be resolved', () => {
    const result = resolveConversationListTag({
      conversation: {
        source: 'web',
        listSourceKey: 'web',
        listSiteKey: 'unknown',
        url: '',
      },
      translate: tr,
    });

    expect(result.label).toBe('insightUnknownLabel');
  });

  it('uses brand tone variables for non-web source keys', () => {
    const chatgpt = resolveConversationListTag({
      conversation: { source: 'chatgpt' },
      translate: tr,
    });
    const claude = resolveConversationListTag({
      conversation: { source: 'claude' },
      translate: tr,
    });
    const kimi = resolveConversationListTag({
      conversation: { source: 'kimi' },
      translate: tr,
    });

    expect(chatgpt.toneClassName).toContain('var(--brand-chatgpt)');
    expect(claude.toneClassName).toContain('var(--brand-claude)');
    expect(kimi.toneClassName).toContain('var(--brand-kimi)');
  });

  it('keeps web tone fixed and not brand-driven', () => {
    const result = resolveConversationListTag({
      conversation: {
        source: 'web',
        listSourceKey: 'web',
        listSiteKey: 'domain:example.com',
      },
      translate: tr,
    });

    expect(result.toneClassName).toContain('var(--border)');
    expect(result.toneClassName).not.toContain('--brand-');
  });
});