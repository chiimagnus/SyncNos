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
export const INSIGHT_ARTICLE_DOMAIN_LIMIT = 5;
export const INSIGHT_TOP_CONVERSATION_LIMIT = 3;
export const INSIGHT_OTHER_LABEL = 'Other';
export const INSIGHT_UNKNOWN_DOMAIN_LABEL = 'Unknown';
export const INSIGHT_UNTITLED_CONVERSATION = 'Untitled';

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

export async function getInsightStats(): Promise<InsightStats> {
  return createEmptyInsightStats();
}
