import { describe, expect, it } from 'vitest';

import { searchMentionCandidates } from '../../src/services/integrations/item-mention/mention-search';

describe('item-mention-search', () => {
  it('filters by title/source/domain and sorts by match score then recency', () => {
    const res = searchMentionCandidates({
      query: 'openai',
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

    const res = searchMentionCandidates({ query: 'openai', candidates, limit: 20 });

    expect(res.candidates).toHaveLength(20);
    expect(res.candidates[0]?.conversationId).toBe(56);
  });
});
