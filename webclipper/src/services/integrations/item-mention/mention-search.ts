import type {
  MentionCandidate,
  MentionQuery,
  MentionSearchResult,
} from '@services/integrations/item-mention/mention-contract';
import {
  normalizeMentionQuery,
  normalizeMentionSearchLimit,
} from '@services/integrations/item-mention/mention-contract';

function safeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeField(value: unknown): string {
  return safeText(value).toLowerCase();
}

function parseDomainFromUrl(url: unknown): string {
  const raw = safeText(url);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    return normalizeField(parsed.hostname);
  } catch (_e) {
    return '';
  }
}

export function normalizeMentionCandidate(
  input: Partial<MentionCandidate> & Record<string, unknown>,
): MentionCandidate {
  const conversationId = Number((input as any).conversationId);
  const lastCapturedAt = Number((input as any).lastCapturedAt);
  return {
    conversationId: Number.isFinite(conversationId) && conversationId > 0 ? conversationId : 0,
    title: safeText((input as any).title),
    source: safeText((input as any).source),
    url: safeText((input as any).url),
    domain: safeText((input as any).domain) || parseDomainFromUrl((input as any).url),
    sourceType: safeText((input as any).sourceType) || 'chat',
    lastCapturedAt: Number.isFinite(lastCapturedAt) && lastCapturedAt > 0 ? lastCapturedAt : 0,
  };
}

type MatchInfo = {
  matched: boolean;
  score: number;
};

function scoreField(fieldValue: string, query: MentionQuery, weight: number): MatchInfo {
  const value = normalizeField(fieldValue);
  if (!value) return { matched: false, score: 0 };
  const q = query.normalized;
  if (!q) return { matched: true, score: 0 };

  if (value === q) return { matched: true, score: weight + 80 };
  if (value.startsWith(q)) return { matched: true, score: weight + 50 };

  const idx = value.indexOf(q);
  if (idx < 0) return { matched: false, score: 0 };
  // Earlier match is better.
  return { matched: true, score: weight + 20 - Math.min(idx, 40) };
}

function scoreCandidate(candidate: MentionCandidate, query: MentionQuery): MatchInfo {
  if (query.empty) return { matched: true, score: 0 };

  const titleScore = scoreField(candidate.title, query, 300);
  const domainScore = scoreField(candidate.domain, query, 200);
  const sourceScore = scoreField(candidate.source, query, 120);

  const matched = titleScore.matched || domainScore.matched || sourceScore.matched;
  if (!matched) return { matched: false, score: 0 };
  return { matched: true, score: titleScore.score + domainScore.score + sourceScore.score };
}

export function searchMentionCandidates(input: {
  query: unknown;
  candidates: Array<Partial<MentionCandidate> & Record<string, unknown>>;
  limit?: unknown;
}): MentionSearchResult {
  const query = normalizeMentionQuery(input.query);
  const limit = normalizeMentionSearchLimit(input.limit, { defaultLimit: 20, maxLimit: 50 });
  const normalized = (Array.isArray(input.candidates) ? input.candidates : []).map((c) => normalizeMentionCandidate(c));

  if (query.empty) {
    const sorted = normalized
      .filter((c) => c.conversationId > 0)
      .sort((a, b) => {
        const at = a.lastCapturedAt || 0;
        const bt = b.lastCapturedAt || 0;
        if (bt !== at) return bt - at;
        return (b.conversationId || 0) - (a.conversationId || 0);
      })
      .slice(0, limit);
    return { query, candidates: sorted, limit };
  }

  const matched: Array<{ c: MentionCandidate; score: number }> = [];
  for (const c of normalized) {
    if (!c || c.conversationId <= 0) continue;
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

  return {
    query,
    candidates: matched.slice(0, limit).map((x) => x.c),
    limit,
  };
}
