import { openDb } from '../../../platform/idb/schema';
import type { Conversation } from '../../../conversations/domain/models';

type MessageCountByConversation = Map<number, number>;

export type InsightDistributionItem = {
  label: string;
  count: number;
};

export type InsightTopConversation = {
  conversationId: number;
  title: string;
  messageCount: number;
  source: string;
};

export type InsightStats = {
  totalClips: number;
  chatCount: number;
  articleCount: number;
  chatSourceDistribution: InsightDistributionItem[];
  totalMessages: number;
  topConversations: InsightTopConversation[];
  articleDomainDistribution: InsightDistributionItem[];
};

export const INSIGHT_CHAT_SOURCE_LIMIT = 4;
export const INSIGHT_ARTICLE_DOMAIN_LIMIT = 4;
export const INSIGHT_TOP_CONVERSATION_LIMIT = 3;
export const INSIGHT_OTHER_LABEL = 'Other';
export const INSIGHT_UNKNOWN_DOMAIN_LABEL = 'Unknown';
export const INSIGHT_UNKNOWN_SOURCE_LABEL = 'Unknown';
export const INSIGHT_UNTITLED_CONVERSATION = 'Untitled';

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error('transaction failed'));
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeSourceType(value: unknown): string {
  return safeString(value).toLowerCase();
}

function normalizeSourceLabel(value: unknown): string {
  return safeString(value) || INSIGHT_UNKNOWN_SOURCE_LABEL;
}

function normalizeConversationTitle(value: unknown): string {
  return safeString(value) || INSIGHT_UNTITLED_CONVERSATION;
}

function compareDistributionItems(a: InsightDistributionItem, b: InsightDistributionItem): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.label.localeCompare(b.label);
}

function buildDistribution(
  counts: Map<string, number>,
  limit: number,
): InsightDistributionItem[] {
  const sorted = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .filter((item) => item.count > 0)
    .sort(compareDistributionItems);

  if (sorted.length <= limit) return sorted;

  const head = sorted.slice(0, limit);
  const otherCount = sorted.slice(limit).reduce((sum, item) => sum + item.count, 0);
  if (otherCount <= 0) return head;
  return [...head, { label: INSIGHT_OTHER_LABEL, count: otherCount }];
}

function parseHostname(value: unknown): string {
  const raw = safeString(value);
  if (!raw) return INSIGHT_UNKNOWN_DOMAIN_LABEL;
  try {
    return new URL(raw).hostname || INSIGHT_UNKNOWN_DOMAIN_LABEL;
  } catch (_error) {
    return INSIGHT_UNKNOWN_DOMAIN_LABEL;
  }
}

async function readAllConversations(
  conversationsStore: IDBObjectStore,
): Promise<Conversation[]> {
  return ((await reqToPromise(conversationsStore.getAll())) as Conversation[]) || [];
}

async function readMessageCounts(
  messagesStore: IDBObjectStore,
): Promise<MessageCountByConversation> {
  const counts: MessageCountByConversation = new Map();

  await new Promise<void>((resolve, reject) => {
    const request = messagesStore.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      const conversationId = Number((cursor.value as { conversationId?: unknown } | undefined)?.conversationId);
      if (Number.isFinite(conversationId) && conversationId > 0) {
        counts.set(conversationId, (counts.get(conversationId) || 0) + 1);
      }

      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });

  return counts;
}

export function createEmptyInsightStats(): InsightStats {
  return {
    totalClips: 0,
    chatCount: 0,
    articleCount: 0,
    chatSourceDistribution: [],
    totalMessages: 0,
    topConversations: [],
    articleDomainDistribution: [],
  };
}

export function hasInsightData(stats: InsightStats | null | undefined): boolean {
  if (!stats) return false;
  return stats.totalClips > 0;
}

export async function getInsightStats(): Promise<InsightStats> {
  const db = await openDb();
  try {
    const t = db.transaction(['conversations', 'messages'], 'readonly');
    const conversationsStore = t.objectStore('conversations');
    const messagesStore = t.objectStore('messages');

    const [conversations, messageCounts] = await Promise.all([
      readAllConversations(conversationsStore),
      readMessageCounts(messagesStore),
    ]);
    await txDone(t);

    const stats = createEmptyInsightStats();

    const chatSources = new Map<string, number>();
    const articleDomains = new Map<string, number>();
    const topConversations: InsightTopConversation[] = [];

    for (const conversation of conversations) {
      const sourceType = normalizeSourceType(conversation.sourceType);

      if (sourceType === 'chat') {
        stats.chatCount += 1;
        const sourceLabel = normalizeSourceLabel(conversation.source);
        chatSources.set(sourceLabel, (chatSources.get(sourceLabel) || 0) + 1);

        const conversationId = Number(conversation.id);
        const messageCount = Number(messageCounts.get(conversationId) || 0);
        stats.totalMessages += messageCount;
        topConversations.push({
          conversationId,
          title: normalizeConversationTitle(conversation.title),
          messageCount,
          source: sourceLabel,
        });
        continue;
      }

      if (sourceType === 'article') {
        stats.articleCount += 1;
        const domain = parseHostname(conversation.url);
        articleDomains.set(domain, (articleDomains.get(domain) || 0) + 1);
      }
    }

    stats.chatSourceDistribution = buildDistribution(chatSources, INSIGHT_CHAT_SOURCE_LIMIT);
    stats.articleDomainDistribution = buildDistribution(articleDomains, INSIGHT_ARTICLE_DOMAIN_LIMIT);
    stats.topConversations = topConversations
      .sort((a, b) => {
        if (b.messageCount !== a.messageCount) return b.messageCount - a.messageCount;
        return b.conversationId - a.conversationId;
      })
      .slice(0, INSIGHT_TOP_CONVERSATION_LIMIT);
    stats.totalClips = stats.chatCount + stats.articleCount;

    return stats;
  } finally {
    db.close();
  }
}
