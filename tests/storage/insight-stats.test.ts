import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import {
  __closeDbForTests,
  syncConversationMessages,
  upsertConversation,
} from '@services/conversations/data/storage-idb';
import { __closeDbForTests as closeCommentsDbForTests, addArticleComment } from '@services/comments/data/storage-idb';
import {
  getInsightStats,
  INSIGHT_ARTICLE_DOMAIN_LIMIT,
  INSIGHT_CHAT_SOURCE_LIMIT,
  INSIGHT_OTHER_LABEL,
  INSIGHT_UNKNOWN_DOMAIN_LABEL,
  INSIGHT_UNKNOWN_SOURCE_LABEL,
  INSIGHT_UNTITLED_CONVERSATION,
} from '../../src/viewmodels/settings/insight-stats';
import { encodeConversationLoc } from '../../src/services/shared/conversation-loc';

async function deleteDb(name: string) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('indexedDB delete failed'));
  });
}

async function seedConversation(input: {
  sourceType: string;
  source: string;
  conversationKey: string;
  title?: string;
  url?: string;
  lastCapturedAt?: number;
  messageCount?: number;
}) {
  const conversation = await upsertConversation({
    sourceType: input.sourceType,
    source: input.source,
    conversationKey: input.conversationKey,
    title: input.title,
    url: input.url,
    lastCapturedAt: input.lastCapturedAt || 0,
  });
  const conversationId = Number(conversation.id);

  const messageCount = Number(input.messageCount || 0);
  if (input.sourceType === 'chat' && messageCount > 0) {
    await syncConversationMessages(
      conversationId,
      Array.from({ length: messageCount }, (_, index) => ({
        messageKey: `${input.conversationKey}-m${index + 1}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        contentText: `message ${index + 1}`,
        sequence: index + 1,
        updatedAt: index + 1,
      })),
    );
  }

  return conversationId;
}

beforeEach(async () => {
  await __closeDbForTests();
  await closeCommentsDbForTests();

  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;

  await deleteDb('webclipper');
});

afterEach(async () => {
  await __closeDbForTests();
  await closeCommentsDbForTests();
});

describe('insight stats', () => {
  it('returns the empty stats shape for an empty database', async () => {
    const stats = await getInsightStats();

    expect(stats).toEqual({
      totalClips: 0,
      chatCount: 0,
      articleCount: 0,
      videoCount: 0,
      chatDailyTrend: [],
      chatSourceDistribution: [],
      totalMessages: 0,
      topConversations: [],
      articleDailyTrend: [],
      articleDomainDistribution: [],
      topArticleCommentedClips: [],
      videoDailyTrend: [],
      videoPlatformDistribution: [],
      topVideoCommentedClips: [],
    });
  });

  it('aggregates mixed chat and article data', async () => {
    await seedConversation({
      sourceType: 'chat',
      source: 'ChatGPT',
      conversationKey: 'chat-1',
      title: 'Architecture',
      lastCapturedAt: 1,
      messageCount: 6,
    });
    await seedConversation({
      sourceType: 'chat',
      source: 'Gemini',
      conversationKey: 'chat-2',
      title: '',
      lastCapturedAt: 2,
      messageCount: 9,
    });
    await seedConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-1',
      title: 'Medium article',
      url: 'https://medium.com/p/123?ref=home',
      lastCapturedAt: 3,
    });
    await seedConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-2',
      title: 'SSPai article',
      url: 'https://sspai.com/post/100',
      lastCapturedAt: 4,
    });

    const stats = await getInsightStats();

    expect(stats.totalClips).toBe(4);
    expect(stats.chatCount).toBe(2);
    expect(stats.articleCount).toBe(2);
    expect(stats.chatDailyTrend.map((item) => item.count)).toEqual([2]);
    expect(stats.articleDailyTrend.map((item) => item.count)).toEqual([2]);
    expect(stats.totalMessages).toBe(15);
    expect(stats.chatSourceDistribution).toEqual([
      { label: 'ChatGPT', count: 1 },
      { label: 'Gemini', count: 1 },
    ]);
    expect(stats.topConversations).toEqual([
      expect.objectContaining({
        title: INSIGHT_UNTITLED_CONVERSATION,
        messageCount: 9,
        source: 'Gemini',
        openSource: 'gemini',
        openConversationKey: 'chat-2',
        loc: encodeConversationLoc({ source: 'gemini', conversationKey: 'chat-2' }),
      }),
      expect.objectContaining({
        title: 'Architecture',
        messageCount: 6,
        source: 'ChatGPT',
        openSource: 'chatgpt',
        openConversationKey: 'chat-1',
        loc: encodeConversationLoc({ source: 'chatgpt', conversationKey: 'chat-1' }),
      }),
    ]);
    expect(stats.articleDomainDistribution).toEqual([
      { label: 'medium.com', count: 1 },
      { label: 'sspai.com', count: 1 },
    ]);
  });

  it('maps invalid article urls to the unknown domain bucket', async () => {
    await seedConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-invalid',
      title: 'Broken',
      url: 'notaurl',
      lastCapturedAt: 1,
    });

    const stats = await getInsightStats();

    expect(stats.articleCount).toBe(1);
    expect(stats.articleDomainDistribution).toEqual([{ label: INSIGHT_UNKNOWN_DOMAIN_LABEL, count: 1 }]);
  });

  it('keeps article domains as full hostnames', async () => {
    await seedConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-sspai-www',
      title: 'SSPai www',
      url: 'https://www.sspai.com/post/1',
      lastCapturedAt: 1,
    });
    await seedConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-sspai-root',
      title: 'SSPai root',
      url: 'https://sspai.com/post/2',
      lastCapturedAt: 2,
    });
    await seedConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-dedao-m',
      title: 'Dedao mobile',
      url: 'https://m.dedao.cn/xxx',
      lastCapturedAt: 3,
    });
    await seedConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-github-io',
      title: 'GitHub Pages',
      url: 'https://foo.github.io/bar',
      lastCapturedAt: 4,
    });

    const stats = await getInsightStats();

    expect(stats.articleCount).toBe(4);
    expect(stats.articleDomainDistribution).toEqual([
      { label: 'foo.github.io', count: 1 },
      { label: 'm.dedao.cn', count: 1 },
      { label: 'sspai.com', count: 1 },
      { label: 'www.sspai.com', count: 1 },
    ]);
  });

  it('includes video transcripts and excludes unknown rows from the total clip count', async () => {
    await seedConversation({
      sourceType: 'chat',
      source: 'ChatGPT',
      conversationKey: 'chat-known',
      title: 'Known chat',
      lastCapturedAt: 1,
      messageCount: 2,
    });
    await seedConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-known',
      title: 'Known article',
      url: 'https://example.com/post',
      lastCapturedAt: 2,
    });
    await seedConversation({
      sourceType: 'video',
      source: 'YouTube',
      conversationKey: 'video-known',
      title: 'Saved transcript',
      url: 'https://www.youtube.com/watch?v=abc',
      lastCapturedAt: 3,
    });
    await seedConversation({
      sourceType: 'video',
      source: 'video',
      conversationKey: 'video-bilibili',
      title: 'Bilibili transcript',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD/',
      lastCapturedAt: 4,
    });
    await seedConversation({
      sourceType: 'video',
      source: 'video',
      conversationKey: 'video-unknown-platform',
      title: 'Unknown platform transcript',
      url: 'https://example.com/watch?v=abc',
      lastCapturedAt: 5,
    });
    await seedConversation({
      sourceType: 'unknown',
      source: 'Unknown',
      conversationKey: 'unknown-ignored',
      title: 'Ignored type',
      lastCapturedAt: 4,
    });

    const stats = await getInsightStats();

    expect(stats.totalClips).toBe(5);
    expect(stats.chatCount).toBe(1);
    expect(stats.articleCount).toBe(1);
    expect(stats.videoCount).toBe(3);
    expect(stats.videoDailyTrend.map((item) => item.count)).toEqual([3]);
    expect(stats.videoPlatformDistribution).toEqual([
      { label: 'Bilibili', count: 1 },
      { label: INSIGHT_UNKNOWN_SOURCE_LABEL, count: 1 },
      { label: 'YouTube', count: 1 },
    ]);
  });

  it('filters video trends and platforms by the selected range', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    await seedConversation({
      sourceType: 'video',
      source: 'video',
      conversationKey: 'video-before-range',
      title: 'Earlier transcript',
      url: 'https://www.youtube.com/watch?v=abc',
      lastCapturedAt: dayMs,
    });
    await seedConversation({
      sourceType: 'video',
      source: 'video',
      conversationKey: 'video-in-range',
      title: 'Current transcript',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD/',
      lastCapturedAt: dayMs * 2,
    });

    const stats = await getInsightStats({ since: dayMs * 2, until: dayMs * 2 + 1 });

    expect(stats.videoCount).toBe(1);
    expect(stats.videoDailyTrend.map((item) => item.count)).toEqual([1]);
    expect(stats.videoPlatformDistribution).toEqual([{ label: 'Bilibili', count: 1 }]);
  });

  it('ranks web articles and video transcripts by local comment count', async () => {
    const articleMost = await seedConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-most-comments',
      title: 'Most commented article',
      url: 'https://example.com/most',
      lastCapturedAt: 1,
    });
    const articleSecond = await seedConversation({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article-second-comments',
      title: 'Second commented article',
      url: 'https://example.com/second',
      lastCapturedAt: 2,
    });
    const videoMost = await seedConversation({
      sourceType: 'video',
      source: 'YouTube',
      conversationKey: 'video-most-comments',
      title: 'Most commented video',
      url: 'https://youtube.com/watch?v=most',
      lastCapturedAt: 3,
    });
    const videoSecond = await seedConversation({
      sourceType: 'video',
      source: 'Bilibili',
      conversationKey: 'video-second-comments',
      title: 'Second commented video',
      url: 'https://bilibili.com/video/BV1xx411c7mD',
      lastCapturedAt: 4,
    });

    for (const [conversationId, canonicalUrl, count] of [
      [articleMost, 'https://example.com/most', 3],
      [articleSecond, 'https://example.com/second', 2],
      [videoMost, 'https://youtube.com/watch?v=most', 4],
      [videoSecond, 'https://bilibili.com/video/BV1xx411c7mD', 1],
    ] as const) {
      for (let index = 0; index < count; index += 1) {
        await addArticleComment({
          conversationId,
          canonicalUrl,
          commentText: `comment ${index + 1}`,
        });
      }
    }

    const stats = await getInsightStats();

    expect(stats.topArticleCommentedClips.map(({ title, commentCount }) => ({ title, commentCount }))).toEqual([
      { title: 'Most commented article', commentCount: 3 },
      { title: 'Second commented article', commentCount: 2 },
    ]);
    expect(stats.topVideoCommentedClips.map(({ title, commentCount }) => ({ title, commentCount }))).toEqual([
      { title: 'Most commented video', commentCount: 4 },
      { title: 'Second commented video', commentCount: 1 },
    ]);
  });

  it('folds long source and domain tails into the other bucket', async () => {
    for (let index = 0; index < INSIGHT_CHAT_SOURCE_LIMIT + 2; index += 1) {
      await seedConversation({
        sourceType: 'chat',
        source: `Source-${index}`,
        conversationKey: `chat-tail-${index}`,
        title: `Chat ${index}`,
        lastCapturedAt: index,
        messageCount: index + 1,
      });
    }

    for (let index = 0; index < INSIGHT_ARTICLE_DOMAIN_LIMIT + 2; index += 1) {
      await seedConversation({
        sourceType: 'article',
        source: 'web',
        conversationKey: `article-tail-${index}`,
        title: `Article ${index}`,
        url: `https://domain-${index}.example-${index}.com/post`,
        lastCapturedAt: index,
      });
    }

    const stats = await getInsightStats();

    expect(stats.chatSourceDistribution.at(-1)).toEqual({
      label: INSIGHT_OTHER_LABEL,
      count: 2,
    });
    expect(stats.articleDomainDistribution.at(-1)).toEqual({
      label: INSIGHT_OTHER_LABEL,
      count: 2,
    });
    expect(stats.topConversations.map((item) => item.messageCount)).toEqual([6, 5, 4]);
  });
});
