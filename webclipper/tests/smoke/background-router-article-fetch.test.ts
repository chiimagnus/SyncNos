import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestBackgroundRouter } from './background-router-testkit';

const articleFetchMocks = vi.hoisted(() => ({
  fetchActiveTabArticle: vi.fn(),
}));

vi.mock('../../src/collectors/web/article-fetch', () => ({
  fetchActiveTabArticle: articleFetchMocks.fetchActiveTabArticle,
}));

afterEach(() => {
  vi.restoreAllMocks();
  articleFetchMocks.fetchActiveTabArticle.mockReset();
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe('background-router article fetch', () => {
  it('routes fetchActiveTabArticle to integration handler', async () => {
    articleFetchMocks.fetchActiveTabArticle.mockResolvedValue({
      conversationId: 7,
      tabId: 42,
    });

    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: 'fetchActiveTabArticle', tabId: 42 });

    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ conversationId: 7, tabId: 42 });
    expect(articleFetchMocks.fetchActiveTabArticle).toHaveBeenCalledTimes(1);
    expect(articleFetchMocks.fetchActiveTabArticle).toHaveBeenCalledWith({ tabId: 42 });
  });

  it('returns integration errors as router errors', async () => {
    articleFetchMocks.fetchActiveTabArticle.mockRejectedValue(new Error('extract failed'));

    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: 'fetchActiveTabArticle' });

    expect(res.ok).toBe(false);
    expect(String(res.error?.message || '')).toContain('extract failed');
  });

  it('broadcasts conversationsChanged after successful fetch', async () => {
    articleFetchMocks.fetchActiveTabArticle.mockResolvedValue({
      conversationId: 123,
    });

    const router = createTestBackgroundRouter();
    const broadcast = vi.fn();
    router.eventsHub.broadcast = broadcast;

    const res = await router.__handleMessageForTests({ type: 'fetchActiveTabArticle' });

    expect(res.ok).toBe(true);
    expect(broadcast).toHaveBeenCalledWith('conversationsChanged', {
      reason: 'articleFetch',
      conversationId: 123,
    });
  });
});
