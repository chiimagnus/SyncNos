import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestBackgroundRouter } from './background-router-testkit';

const articleFetchMocks = vi.hoisted(() => ({
  fetchActiveTabArticle: vi.fn(),
  resolveOrCaptureActiveTabArticle: vi.fn(),
}));

vi.mock('../../src/collectors/web/article-fetch', () => ({
  fetchActiveTabArticle: articleFetchMocks.fetchActiveTabArticle,
  resolveOrCaptureActiveTabArticle: articleFetchMocks.resolveOrCaptureActiveTabArticle,
}));

afterEach(() => {
  vi.restoreAllMocks();
  articleFetchMocks.fetchActiveTabArticle.mockReset();
  articleFetchMocks.resolveOrCaptureActiveTabArticle.mockReset();
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

  it('preserves strict discourse OP missing error message', async () => {
    articleFetchMocks.fetchActiveTabArticle.mockRejectedValue(new Error('Discourse OP not found'));

    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: 'fetchActiveTabArticle' });

    expect(res.ok).toBe(false);
    expect(String(res.error?.message || '')).toContain('Discourse OP not found');
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

  it('preserves strict discourse OP missing error on resolveOrCapture route', async () => {
    articleFetchMocks.resolveOrCaptureActiveTabArticle.mockRejectedValue(new Error(' discourse op not found '));

    const router = createTestBackgroundRouter();
    const res = await router.__handleMessageForTests({ type: 'resolveOrCaptureActiveTabArticle' });

    expect(res.ok).toBe(false);
    expect(String(res.error?.message || '')).toContain('Discourse OP not found');
  });

  it('broadcasts conversationsChanged only for newly captured resolveOrCapture result', async () => {
    articleFetchMocks.resolveOrCaptureActiveTabArticle.mockResolvedValue({
      isNew: true,
      conversationId: 77,
    });

    const router = createTestBackgroundRouter();
    const broadcast = vi.fn();
    router.eventsHub.broadcast = broadcast;

    const res = await router.__handleMessageForTests({ type: 'resolveOrCaptureActiveTabArticle' });

    expect(res.ok).toBe(true);
    expect(broadcast).toHaveBeenCalledWith('conversationsChanged', {
      reason: 'articleFetch',
      conversationId: 77,
    });
  });
});
