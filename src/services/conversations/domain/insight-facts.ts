import type { Conversation } from '@services/conversations/domain/models';
import {
  INSIGHT_FACTS_ARTICLE_DOMAIN_BUCKET_LIMIT,
  INSIGHT_FACTS_CHAT_SOURCE_BUCKET_LIMIT,
  parseInsightFactsSnapshot,
  parseInsightStatsRequestPayload,
  type InsightFactsDailyCount,
  type InsightFactsKeyCount,
  type InsightFactsSnapshot,
  type InsightStatsRequestPayload,
} from '@services/local-data/contracts';
import { parseHostnameFromUrl } from '@services/url-cleaning/hostname';

export type InsightFactsSourceData = Readonly<{
  conversations: readonly Conversation[];
  messageCounts: ReadonlyMap<number, number>;
}>;

function text(value: unknown): string {
  return String(value || '').trim();
}

function nonNegativeCount(value: unknown): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topKeyCounts(
  map: ReadonlyMap<string, number>,
  limit: number,
): Readonly<{ items: readonly InsightFactsKeyCount[]; otherCount: number }> {
  const sorted = [...map.entries()]
    .map(([key, count]) => Object.freeze({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  return Object.freeze({
    items: Object.freeze(sorted.slice(0, limit)),
    otherCount: sorted.slice(limit).reduce((sum, item) => sum + item.count, 0),
  });
}

function sortedDailyCounts(map: ReadonlyMap<string, number>): readonly InsightFactsDailyCount[] {
  return Object.freeze(
    [...map.entries()]
      .map(([day, count]) => Object.freeze({ day, count }))
      .sort((left, right) => left.day.localeCompare(right.day)),
  );
}

function createDayKeyFormatter(timeZone: string): (timestamp: number) => string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  });
  return (timestamp: number) => {
    const parts = formatter.formatToParts(timestamp);
    const year = parts.find((part) => part.type === 'year')?.value || '';
    const month = parts.find((part) => part.type === 'month')?.value || '';
    const day = parts.find((part) => part.type === 'day')?.value || '';
    return `${year}-${month}-${day}`;
  };
}

/**
 * Builds a compact, backend-neutral Insight snapshot. Storage implementations keep
 * raw conversation/message data local and only return aggregate counts plus three
 * stable top-conversation references across the browser/Native boundary.
 */
export function buildInsightFactsSnapshot(
  source: InsightFactsSourceData,
  requestValue: InsightStatsRequestPayload,
): InsightFactsSnapshot {
  const request = parseInsightStatsRequestPayload(requestValue);
  const dayKey = createDayKeyFormatter(request.timeZone);
  const ranged = request.since !== undefined && request.until !== undefined;
  const chatDailyCounts = new Map<string, number>();
  const articleDailyCounts = new Map<string, number>();
  const chatSourceCounts = new Map<string, number>();
  const articleDomainCounts = new Map<string, number>();
  const topConversations: Array<{
    conversationId: number;
    conversationKey: string;
    messageCount: number;
    source: string;
    title: string;
  }> = [];
  let chatCount = 0;
  let articleCount = 0;
  let totalMessages = 0;
  let chatUnknownDateCount = 0;
  let articleUnknownDateCount = 0;

  for (const conversation of source.conversations) {
    const timestamp = Number(conversation.lastCapturedAt);
    const hasTimestamp = Number.isFinite(timestamp) && timestamp > 0;
    if (ranged && (!hasTimestamp || timestamp < (request.since as number) || timestamp > (request.until as number))) {
      continue;
    }

    const sourceType = text(conversation.sourceType).toLowerCase();
    if (sourceType !== 'chat' && sourceType !== 'article') continue;

    if (sourceType === 'chat') {
      chatCount += 1;
      increment(chatSourceCounts, text(conversation.source));
      if (hasTimestamp) increment(chatDailyCounts, dayKey(timestamp));
      else chatUnknownDateCount += 1;

      const conversationId = Number(conversation.id);
      if (!Number.isSafeInteger(conversationId) || conversationId <= 0) continue;
      const messageCount = nonNegativeCount(source.messageCounts.get(conversationId));
      totalMessages += messageCount;
      const stableSource = text(conversation.source);
      const conversationKey = text(conversation.conversationKey);
      if (stableSource && conversationKey) {
        topConversations.push({
          conversationId,
          conversationKey,
          messageCount,
          source: stableSource,
          title: String(conversation.title || ''),
        });
      }
      continue;
    }

    articleCount += 1;
    increment(articleDomainCounts, parseHostnameFromUrl(conversation.url));
    if (hasTimestamp) increment(articleDailyCounts, dayKey(timestamp));
    else articleUnknownDateCount += 1;
  }

  topConversations.sort((left, right) => {
    if (right.messageCount !== left.messageCount) return right.messageCount - left.messageCount;
    return right.conversationId - left.conversationId;
  });
  const articleDomains = topKeyCounts(articleDomainCounts, INSIGHT_FACTS_ARTICLE_DOMAIN_BUCKET_LIMIT);
  const chatSources = topKeyCounts(chatSourceCounts, INSIGHT_FACTS_CHAT_SOURCE_BUCKET_LIMIT);

  return parseInsightFactsSnapshot({
    articleCount,
    articleDailyCounts: sortedDailyCounts(articleDailyCounts),
    articleDomainCounts: articleDomains.items,
    articleOtherDomainCount: articleDomains.otherCount,
    articleUnknownDateCount,
    chatCount,
    chatDailyCounts: sortedDailyCounts(chatDailyCounts),
    chatOtherSourceCount: chatSources.otherCount,
    chatSourceCounts: chatSources.items,
    chatUnknownDateCount,
    topConversations: topConversations.slice(0, 3),
    totalMessages,
  });
}
