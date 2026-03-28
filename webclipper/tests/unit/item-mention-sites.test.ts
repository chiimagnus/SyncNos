import { describe, expect, it } from 'vitest';

import {
  isMentionSupportedHost,
  listMentionSupportedHosts,
  pickMentionSupportedSiteIdByHostname,
} from '../../src/services/integrations/item-mention/content/mention-sites';

describe('item-mention sites', () => {
  it('lists supported hosts', () => {
    const hosts = listMentionSupportedHosts();
    expect(hosts).toContain('chatgpt.com');
    expect(hosts).toContain('notion.so');
  });

  it('matches subdomains', () => {
    expect(isMentionSupportedHost('www.chatgpt.com')).toBe(true);
    expect(isMentionSupportedHost('chat.openai.com')).toBe(true);
    expect(isMentionSupportedHost('www.notion.so')).toBe(true);
    expect(isMentionSupportedHost('foo.notion.so')).toBe(true);
  });

  it('does not enable for non-mention sites', () => {
    expect(isMentionSupportedHost('claude.ai')).toBe(false);
    expect(isMentionSupportedHost('gemini.google.com')).toBe(false);
  });

  it('picks site id', () => {
    expect(pickMentionSupportedSiteIdByHostname('chatgpt.com')).toBe('chatgpt');
    expect(pickMentionSupportedSiteIdByHostname('www.notion.so')).toBe('notionai');
  });
});

