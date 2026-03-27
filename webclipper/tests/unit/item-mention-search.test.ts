import { describe, expect, it } from 'vitest';

import { searchMentionCandidates } from '../../src/services/integrations/item-mention/mention-search';

describe('item-mention-search', () => {
  it('returns most recent items for empty query', () => {
    const res = searchMentionCandidates({
      query: '',
      candidates: [
        { conversationId: 1, title: 'A', source: 'chatgpt', url: 'https://a.com', lastCapturedAt: 1000, sourceType: 'chat' },
        { conversationId: 2, title: 'B', source: 'chatgpt', url: 'https://b.com', lastCapturedAt: 3000, sourceType: 'chat' },
        { conversationId: 3, title: 'C', source: 'web', url: 'https://c.com', lastCapturedAt: 2000, sourceType: 'article' },
      ],
      limit: 10,
    });

    expect(res.candidates.map((c) => c.conversationId)).toEqual([2, 3, 1]);
  });

  it('filters by title/source/domain and sorts by match score then recency', () => {
    const res = searchMentionCandidates({
      query: 'openai',
      candidates: [
        { conversationId: 1, title: 'Hello world', source: 'chatgpt', url: 'https://openai.com/blog', lastCapturedAt: 1000, sourceType: 'article' },
        { conversationId: 2, title: 'OpenAI paper', source: 'chatgpt', url: 'https://example.com', lastCapturedAt: 900, sourceType: 'chat' },
        { conversationId: 3, title: 'Something else', source: 'openai', url: 'https://foo.com', lastCapturedAt: 5000, sourceType: 'chat' },
        { conversationId: 4, title: 'Nothing', source: 'chatgpt', url: 'https://bar.com', lastCapturedAt: 9999, sourceType: 'chat' },
      ],
      limit: 10,
    });

    // title exact/prefix matches outrank domain/source; tie-break by recency.
    expect(res.candidates.map((c) => c.conversationId)).toEqual([2, 1, 3]);
  });

  it('enforces max limit', () => {
    const candidates = Array.from({ length: 200 }, (_, i) => ({
      conversationId: i + 1,
      title: `T${i + 1}`,
      source: 'chatgpt',
      url: 'https://x.com',
      lastCapturedAt: i + 1,
      sourceType: 'chat',
    }));

    const res = searchMentionCandidates({ query: '', candidates, limit: 999 });
    expect(res.candidates.length).toBeLessThanOrEqual(50);
  });
});

