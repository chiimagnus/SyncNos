import { describe, expect, it } from 'vitest';

import { buildChatWithCommentPayloadV1 } from '../../src/services/integrations/chatwith/chatwith-comment-payload';
import { truncateForChatWith } from '../../src/services/integrations/chatwith/chatwith-settings';

describe('buildChatWithCommentPayloadV1', () => {
  it('builds payload with quote/comment/title/url and trailing newline', () => {
    const payload = buildChatWithCommentPayloadV1({
      quoteText: 'Selected quote text',
      commentText: 'Reply 1 (You):\nMy comment text',
      articleTitle: 'An Article',
      canonicalUrl: 'https://example.com/article',
      promptTemplate: '',
    });

    expect(payload).toContain('Article Title: An Article');
    expect(payload).toContain('Article URL: https://example.com/article');
    expect(payload).toContain('Quote:');
    expect(payload).toContain('Selected quote text');
    expect(payload).toContain('My comment text');
    expect(payload.endsWith('\n')).toBe(true);
  });

  it('omits quote section when quoteText is empty', () => {
    const payload = buildChatWithCommentPayloadV1({
      quoteText: '   ',
      commentText: 'Reply 1:\nMy comment text',
      articleTitle: 'An Article',
      canonicalUrl: 'https://example.com/article',
    });

    expect(payload).not.toContain('Quote:');
    expect(payload).toContain('My comment text');
  });

  it('handles empty article title/url without throwing', () => {
    const payload = buildChatWithCommentPayloadV1({
      commentText: 'Only comment',
      articleTitle: '',
      canonicalUrl: '',
    });

    expect(payload).toContain('Article Title: ');
    expect(payload).toContain('Article URL: ');
    expect(payload).toContain('Only comment');
  });

  it('returns empty payload when commentText is empty', () => {
    const payload = buildChatWithCommentPayloadV1({
      quoteText: 'quote',
      commentText: '   ',
      articleTitle: 'Title',
      canonicalUrl: 'https://example.com/article',
    });

    expect(payload).toBe('');
  });

  it('supports custom template rendering and truncation suffix behavior', () => {
    const payload = buildChatWithCommentPayloadV1({
      quoteText: 'Q',
      commentText: `Reply 1:\n${'C'.repeat(200)}`,
      articleTitle: 'T',
      canonicalUrl: 'https://example.com/x',
      promptTemplate: 'Title={{article_title}}\nURL={{article_url}}\n---\n{{article_content}}',
    });

    expect(payload).toContain('Title=T');
    expect(payload).toContain('URL=https://example.com/x');
    expect(payload).toContain('Reply 1:');

    const truncated = truncateForChatWith(payload, 80);
    expect(truncated.truncated).toBe(true);
    expect(truncated.text).toContain('[Truncated: original length=');
  });
});
