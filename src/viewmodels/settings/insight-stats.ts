import { formatConversationTitle, t } from '@i18n';
import {
  INSIGHT_FACTS_ARTICLE_DOMAIN_BUCKET_LIMIT,
  INSIGHT_FACTS_CHAT_SOURCE_BUCKET_LIMIT,
  type InsightFactsDailyCount,
  type InsightFactsKeyCount,
  type InsightFactsSnapshot,
} from '@services/local-data/contracts';
import { encodeConversationLoc } from '@services/shared/conversation-loc';

export type InsightTimeRange = 'all' | 'today' | '7d' | '30d';

export type InsightDistributionItem = {
  label: string;
  count: number;
};

export type InsightDailyTrendPoint = {
  dayStart: number;
  count: number;
};

export type InsightTopConversation = {
  conversationId: number;
  title: string;
  messageCount: number;
  source: string;
  openSource: string;
  openConversationKey: string;
  loc: string;
};

export type InsightStats = {
  totalClips: number;
  chatCount: number;
  articleCount: number;
  chatDailyTrend: InsightDailyTrendPoint[];
  chatSourceDistribution: InsightDistributionItem[];
  totalMessages: number;
  topConversations: InsightTopConversation[];
  articleDailyTrend: InsightDailyTrendPoint[];
  articleDomainDistribution: InsightDistributionItem[];
};

export const INSIGHT_CHAT_SOURCE_LIMIT = INSIGHT_FACTS_CHAT_SOURCE_BUCKET_LIMIT;
export const INSIGHT_ARTICLE_DOMAIN_LIMIT = INSIGHT_FACTS_ARTICLE_DOMAIN_BUCKET_LIMIT;
export const INSIGHT_TOP_CONVERSATION_LIMIT = 3;
export const INSIGHT_OTHER_LABEL = t('insightOtherLabel');
export const INSIGHT_UNKNOWN_DOMAIN_LABEL = t('insightUnknownLabel');
export const INSIGHT_UNKNOWN_SOURCE_LABEL = t('insightUnknownLabel');
export const INSIGHT_UNKNOWN_DATE_LABEL = t('insightUnknownLabel');
export const INSIGHT_UNTITLED_CONVERSATION = t('untitled');

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeSourceLabel(value: unknown): string {
  return safeString(value) || INSIGHT_UNKNOWN_SOURCE_LABEL;
}

function normalizeConversationTitle(value: unknown): string {
  return formatConversationTitle(safeString(value));
}

function dayKeyFromDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromDayKey(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dailyTrendFromFacts(
  counts: readonly InsightFactsDailyCount[],
  unknownCount: number,
  options?: { since?: number; until?: number },
): InsightDailyTrendPoint[] {
  const byDay = new Map(counts.map((item) => [item.day, item.count] as const));
  const since = Number(options?.since);
  const until = Number(options?.until);
  const hasRange = Number.isFinite(since) && Number.isFinite(until) && since > 0 && until > 0 && until >= since;
  const out: InsightDailyTrendPoint[] = [];

  if (hasRange) {
    const cursor = new Date(since);
    const end = new Date(until);
    cursor.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= end.getTime()) {
      out.push({ dayStart: cursor.getTime(), count: byDay.get(dayKeyFromDate(cursor)) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  const knownDates = counts
    .map((item) => dateFromDayKey(item.day))
    .filter((value): value is Date => value !== null)
    .sort((left, right) => left.getTime() - right.getTime());
  if (unknownCount > 0) out.push({ dayStart: -1, count: unknownCount });
  if (!knownDates.length) return out;

  const cursor = new Date(knownDates[0]);
  const end = knownDates.at(-1)!;
  while (cursor.getTime() <= end.getTime()) {
    out.push({ dayStart: cursor.getTime(), count: byDay.get(dayKeyFromDate(cursor)) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function distributionFromFacts(
  counts: readonly InsightFactsKeyCount[],
  otherCount: number,
  normalizeLabel: (value: string) => string,
): InsightDistributionItem[] {
  const merged = new Map<string, number>();
  for (const item of counts) {
    const label = normalizeLabel(item.key);
    merged.set(label, (merged.get(label) ?? 0) + item.count);
  }
  const out = [...merged.entries()]
    .map(([label, count]) => ({ label, count }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  if (otherCount > 0) out.push({ label: INSIGHT_OTHER_LABEL, count: otherCount });
  return out;
}

export function createEmptyInsightStats(): InsightStats {
  return {
    totalClips: 0,
    chatCount: 0,
    articleCount: 0,
    chatDailyTrend: [],
    chatSourceDistribution: [],
    totalMessages: 0,
    topConversations: [],
    articleDailyTrend: [],
    articleDomainDistribution: [],
  };
}

export function hasInsightData(stats: InsightStats | null | undefined): boolean {
  if (!stats) return false;
  return stats.totalClips > 0;
}

export function getInsightTimeZone(): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof timeZone === 'string' && timeZone.trim()) return timeZone;
  } catch (_error) {
    // Browsers with no resolved IANA zone use UTC rather than inventing an offset.
  }
  return 'UTC';
}

export function getInsightTimeRangeWindow(range: InsightTimeRange, now = Date.now()): { since: number; until: number } {
  if (range === 'all') return { since: 0, until: 0 };
  const until = Number.isFinite(now) ? now : Date.now();
  const start = new Date(until);
  start.setHours(0, 0, 0, 0);
  if (range === '7d') start.setDate(start.getDate() - 6);
  if (range === '30d') start.setDate(start.getDate() - 29);
  return { since: start.getTime(), until };
}

export function buildInsightStatsFromFactsSnapshot(
  snapshot: InsightFactsSnapshot,
  options?: { since?: number; until?: number },
): InsightStats {
  const stats = createEmptyInsightStats();
  stats.chatCount = snapshot.chatCount;
  stats.articleCount = snapshot.articleCount;
  stats.totalClips = snapshot.chatCount + snapshot.articleCount;
  stats.totalMessages = snapshot.totalMessages;
  stats.chatDailyTrend = dailyTrendFromFacts(snapshot.chatDailyCounts, snapshot.chatUnknownDateCount, options);
  stats.articleDailyTrend = dailyTrendFromFacts(snapshot.articleDailyCounts, snapshot.articleUnknownDateCount, options);
  stats.chatSourceDistribution = distributionFromFacts(
    snapshot.chatSourceCounts,
    snapshot.chatOtherSourceCount,
    normalizeSourceLabel,
  );
  stats.articleDomainDistribution = distributionFromFacts(
    snapshot.articleDomainCounts,
    snapshot.articleOtherDomainCount,
    (value) => safeString(value) || INSIGHT_UNKNOWN_DOMAIN_LABEL,
  );
  stats.topConversations = snapshot.topConversations.map((conversation) => {
    const openSource = safeString(conversation.source).toLowerCase();
    const openConversationKey = safeString(conversation.conversationKey);
    return {
      conversationId: conversation.conversationId,
      title: normalizeConversationTitle(conversation.title),
      messageCount: conversation.messageCount,
      source: normalizeSourceLabel(conversation.source),
      openSource,
      openConversationKey,
      loc:
        openSource && openConversationKey
          ? encodeConversationLoc({ source: openSource, conversationKey: openConversationKey })
          : '',
    };
  });
  return stats;
}
