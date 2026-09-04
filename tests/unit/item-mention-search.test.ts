import { describe, expect, it } from 'vitest';

import { searchMentionCandidates } from '../../src/services/integrations/item-mention/mention-search';

describe('item-mention-search', () => {
  it('preserves recent pool order for empty query', () => {
    const res = searchMentionCandidates({
      query: { normalized: '', empty: true },
      candidates: [
        { conversationId: 2, title: 'B', source: 'chatgpt', domain: 'b.com', lastCapturedAt: 3000 },
        { conversationId: 3, title: 'C', source: 'web', domain: 'c.com', lastCapturedAt: 2000 },
        { conversationId: 1, title: 'A', source: 'chatgpt', domain: 'a.com', lastCapturedAt: 1000 },
      ],
      limit: 10,
    });

    expect(res.candidates.map((c) => c.conversationId)).toEqual([2, 3, 1]);
  });

  it('filters by title/source/domain and sorts by match score then recency', () => {
    const res = searchMentionCandidates({
      query: { normalized: 'openai', empty: false },
      candidates: [
        {
          conversationId: 1,
          title: 'Hello world',
          source: 'chatgpt',
          domain: 'openai.com',
          lastCapturedAt: 1000,
        },
        {
          conversationId: 2,
          title: 'OpenAI paper',
          source: 'chatgpt',
          domain: 'example.com',
          lastCapturedAt: 900,
        },
        {
          conversationId: 3,
          title: 'Something else',
          source: 'openai',
          domain: 'foo.com',
          lastCapturedAt: 5000,
        },
        {
          conversationId: 4,
          title: 'Nothing',
          source: 'chatgpt',
          domain: 'bar.com',
          lastCapturedAt: 9999,
        },
      ],
      limit: 10,
    });

    // title exact/prefix matches outrank domain/source; tie-break by recency.
    expect(res.candidates.map((c) => c.conversationId)).toEqual([2, 1, 3]);
  });

  it('scores the entire candidate array before applying the final limit', () => {
    const candidates = Array.from({ length: 60 }, (_, index) => ({
      conversationId: index + 1,
      title: index === 55 ? 'OpenAI' : `Weak ${index + 1}`,
      source: index < 55 ? 'openai-weak' : 'chatgpt',
      domain: 'example.com',
      lastCapturedAt: 10_000 - index,
    }));

    const res = searchMentionCandidates({ query: { normalized: 'openai', empty: false }, candidates, limit: 20 });

    expect(res.candidates).toHaveLength(20);
    expect(res.candidates[0]?.conversationId).toBe(56);
  });

  it('applies the already-normalized final limit', () => {
    const candidates = Array.from({ length: 200 }, (_, i) => ({
      conversationId: i + 1,
      title: `T${i + 1}`,
      source: 'chatgpt',
      domain: 'x.com',
      lastCapturedAt: i + 1,
    }));

    const res = searchMentionCandidates({ query: { normalized: '', empty: true }, candidates, limit: 50 });
    expect(res.candidates).toHaveLength(50);
  });
});
