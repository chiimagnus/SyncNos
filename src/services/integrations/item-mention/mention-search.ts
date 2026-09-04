import type { MentionCandidate, MentionSearchResult } from '@services/integrations/item-mention/mention-contract';

type MatchInfo = {
  matched: boolean;
  score: number;
};

function scoreField(fieldValue: string, query: string, weight: number): MatchInfo {
  const value = fieldValue.toLowerCase();
  if (!value) return { matched: false, score: 0 };
  if (value === query) return { matched: true, score: weight + 80 };
  if (value.startsWith(query)) return { matched: true, score: weight + 50 };

  const idx = value.indexOf(query);
  if (idx < 0) return { matched: false, score: 0 };
  // Earlier match is better.
  return { matched: true, score: weight + 20 - Math.min(idx, 40) };
}

function scoreCandidate(candidate: MentionCandidate, query: string): MatchInfo {
  const titleScore = scoreField(candidate.title, query, 300);
  const domainScore = scoreField(candidate.domain, query, 200);
  const sourceScore = scoreField(candidate.source, query, 120);

  const matched = titleScore.matched || domainScore.matched || sourceScore.matched;
  if (!matched) return { matched: false, score: 0 };
  return { matched: true, score: titleScore.score + domainScore.score + sourceScore.score };
}

export function searchMentionCandidates(input: {
  query: string;
  candidates: MentionCandidate[];
  limit: number;
}): MentionSearchResult {
  const { query, candidates, limit } = input;
  if (!query) return { candidates: candidates.slice(0, limit) };

  const matched: Array<{ c: MentionCandidate; score: number }> = [];
  for (const c of candidates) {
    const info = scoreCandidate(c, query);
    if (!info.matched) continue;
    matched.push({ c, score: info.score });
  }

  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = a.c.lastCapturedAt || 0;
    const bt = b.c.lastCapturedAt || 0;
    if (bt !== at) return bt - at;
    return (b.c.conversationId || 0) - (a.c.conversationId || 0);
  });

  return { candidates: matched.slice(0, limit).map((x) => x.c) };
}
