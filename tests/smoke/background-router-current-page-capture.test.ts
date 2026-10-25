import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/platform/webext/tabs', () => ({
  tabsQuery: vi.fn(),
  tabsSendMessage: vi.fn(),
}));

import { tabsQuery, tabsSendMessage } from '../../src/platform/webext/tabs';
import { createTestBackgroundRouter } from './background-router-testkit';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('background-router current page capture relay', () => {
  it('returns active tab capture state from content script', async () => {
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 7, url: 'https://chatgpt.com/c/123' }] as any);
    vi.mocked(tabsSendMessage).mockResolvedValue({
      ok: true,
      data: {
        kind: 'chat',
        label: 'Fetch AI Chat',
        collectorId: 'chatgpt',
      },
      error: null,
    });

    const router = createTestBackgroundRouter();
    const response = await router.dispatch({ type: 'getActiveTabCaptureState' });

    expect(response.ok).toBe(true);
    expect(response.data).toEqual({
      kind: 'chat',
      label: 'Fetch AI Chat',
      collectorId: 'chatgpt',
    });
    expect(tabsSendMessage).toHaveBeenCalledWith(7, { type: 'getCurrentPageCaptureState' });
  });

  it('returns unavailable state for non-http active tab', async () => {
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 9, url: 'chrome://extensions/' }] as any);

    const router = createTestBackgroundRouter();
    const response = await router.dispatch({ type: 'getActiveTabCaptureState' });

    expect(response.ok).toBe(true);
    expect(response.data?.kind).toBe('unsupported');
    expect(tabsSendMessage).not.toHaveBeenCalled();
  });

  it('surfaces content capture-state failures as errors instead of unsupported state', async () => {
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 10, url: 'https://chatgpt.com/c/123' }] as any);
    vi.mocked(tabsSendMessage).mockResolvedValue({
      ok: false,
      data: null,
      error: { message: 'capture state failed', extra: null },
    } as any);

    const router = createTestBackgroundRouter();
    const response = await router.dispatch({ type: 'getActiveTabCaptureState' });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toBe('capture state failed');
    expect(response.error?.extra).toEqual({ code: 'CAPTURE_FAILED' });
  });

  it('forwards safe ChatGPT API diagnostic codes without exposing arbitrary error fields', async () => {
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 31, url: 'https://chatgpt.com/c/123' }] as any);
    vi.mocked(tabsSendMessage).mockResolvedValue({
      ok: false,
      data: null,
      error: {
        message: 'Advanced capture temporarily unavailable',
        extra: { code: 'chatgpt_api_page_http', status: 503, accessToken: 'must-not-escape' },
      },
    } as any);
    const router = createTestBackgroundRouter();
    expect(await router.dispatch({ type: 'captureActiveTabCurrentPage' })).toMatchObject({
      ok: false,
      error: {
        message: 'Advanced capture temporarily unavailable',
        extra: { code: 'chatgpt_api_page_http', status: 503 },
      },
    });
    vi.mocked(tabsSendMessage).mockResolvedValue({
      ok: false,
      data: null,
      error: { message: 'Opaque internal error', extra: { code: 'MY_SECRET_CODE', status: 503 } },
    } as any);
    expect(await router.dispatch({ type: 'captureActiveTabCurrentPage' })).toMatchObject({
      ok: false,
      error: { extra: { code: 'CAPTURE_FAILED' } },
    });
  });

  it('relays shortcut capture through the canonical capture command', async () => {
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 11, url: 'https://example.com/article' }] as any);
    vi.mocked(tabsSendMessage).mockResolvedValue({ ok: true, data: { title: 'Saved' }, error: null });

    const router = createTestBackgroundRouter();
    const response = await router.dispatch({ type: 'captureActiveTabCurrentPage' });

    expect(response.ok).toBe(true);
    expect(tabsSendMessage).toHaveBeenCalledWith(11, {
      type: 'captureCurrentPage',
    });
  });

  it('uses the same capture command regardless of caller metadata', async () => {
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 12, url: 'https://example.com/article' }] as any);
    vi.mocked(tabsSendMessage).mockResolvedValue({ ok: true, data: { title: 'Saved' }, error: null });

    const router = createTestBackgroundRouter();
    const response = await router.dispatch({ type: 'captureActiveTabCurrentPage', source: 'unexpected' });

    expect(response.ok).toBe(true);
    expect(tabsSendMessage).toHaveBeenCalledWith(12, { type: 'captureCurrentPage' });
  });
});
