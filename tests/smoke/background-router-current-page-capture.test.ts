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
  it('captures the last-focused browser window tab, not the background context window', async () => {
    vi.mocked(tabsQuery).mockImplementation(async (query: any) => {
      if (query.lastFocusedWindow) return [{ id: 2236, url: 'https://chatgpt.com/c/test', windowId: 2 }];
      if (query.currentWindow) return [{ id: 2232, url: 'https://chatgpt.com/c/other', windowId: 1 }];
      return [];
    });
    vi.mocked(tabsSendMessage).mockResolvedValue({ ok: true, data: { conversationId: 2236 }, error: null });

    const response = await createTestBackgroundRouter().dispatch({ type: 'captureActiveTabCurrentPage' });
    expect(response).toMatchObject({ ok: true, data: { conversationId: 2236 } });
    expect(tabsQuery).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(tabsSendMessage).toHaveBeenCalledWith(2236, { type: 'captureCurrentPage' });
    expect(tabsSendMessage).not.toHaveBeenCalledWith(2232, expect.anything());
  });

  it('selects exactly one open tab by its explicit URL, even when another window is focused', async () => {
    const url = 'http://127.0.0.1:38941/index.html';
    vi.mocked(tabsQuery).mockImplementation(async (query: any) => {
      if (query.url)
        return [
          { id: 20, url: 'https://chatgpt.com/c/other', windowId: 1, active: true },
          { id: 21, url, windowId: 2, active: false },
        ] as any;
      return [{ id: 20, url: 'https://chatgpt.com/c/other', windowId: 1 }];
    });
    vi.mocked(tabsSendMessage).mockResolvedValue({ ok: true, data: { conversationId: 200 }, error: null });
    const response = await createTestBackgroundRouter().dispatch({ type: 'captureActiveTabCurrentPage', url });
    expect(response).toMatchObject({ ok: true, data: { conversationId: 200 } });
    expect(tabsQuery).toHaveBeenCalledOnce();
    expect(tabsQuery).toHaveBeenCalledWith({ url: ['http://*/*', 'https://*/*'] });
    expect(tabsSendMessage).toHaveBeenCalledWith(21, { type: 'captureCurrentPage', payload: { expectedUrl: url } });
    expect(tabsSendMessage).not.toHaveBeenCalledWith(20, expect.anything());
  });

  it.each([
    ['no matching page', [{ id: 2, url: 'https://example.com/other' }], 'CAPTURE_TARGET_NOT_FOUND'],
    [
      'duplicate matching pages',
      [
        { id: 2, url: 'https://example.com/target' },
        { id: 3, url: 'https://example.com/target' },
      ],
      'CAPTURE_TARGET_AMBIGUOUS',
    ],
    ['matching tab without a valid id', [{ url: 'https://example.com/target' }], 'CAPTURE_TARGET_NOT_FOUND'],
  ])('refuses %s without forwarding a capture', async (_label, tabs, errorCode) => {
    vi.mocked(tabsQuery).mockResolvedValue(tabs as any);
    const response = await createTestBackgroundRouter().dispatch({
      type: 'captureActiveTabCurrentPage',
      url: 'https://example.com/target',
    });
    expect(response).toMatchObject({ ok: false, error: { extra: { code: errorCode } } });
    expect(tabsSendMessage).not.toHaveBeenCalled();
  });

  it.each([
    'not-a-url',
    'file:///private/file.txt',
    'javascript:alert(1)',
    'https://user:pass@example.com/',
    'https://example.com/\nother',
  ])('rejects unsafe explicit URL %s before querying tabs', async (url) => {
    const response = await createTestBackgroundRouter().dispatch({ type: 'captureActiveTabCurrentPage', url });
    expect(response).toMatchObject({ ok: false, error: { extra: { code: 'INVALID_ARGUMENT' } } });
    expect(tabsQuery).not.toHaveBeenCalled();
    expect(tabsSendMessage).not.toHaveBeenCalled();
  });

  it('passes through a changed-target error and never claims an unrelated page was captured', async () => {
    vi.mocked(tabsQuery).mockResolvedValue([{ id: 21, url: 'https://example.com/target' }] as any);
    vi.mocked(tabsSendMessage).mockResolvedValue({
      ok: false,
      error: { message: 'Capture target changed', extra: { code: 'CAPTURE_TARGET_CHANGED' } },
    } as any);
    const response = await createTestBackgroundRouter().dispatch({
      type: 'captureActiveTabCurrentPage',
      url: 'https://example.com/target',
    });
    expect(response).toMatchObject({ ok: false, error: { extra: { code: 'CAPTURE_TARGET_CHANGED' } } });
  });

  it('retrieves state from the same last-focused tab as capture', async () => {
    vi.mocked(tabsQuery).mockImplementation(async (query: any) =>
      query.lastFocusedWindow ? [{ id: 20, url: 'https://example.com/active', windowId: 4 }] : [],
    );
    vi.mocked(tabsSendMessage).mockResolvedValue({ ok: true, data: { kind: 'article' }, error: null });

    const response = await createTestBackgroundRouter().dispatch({ type: 'getActiveTabCaptureState' });
    expect(response).toMatchObject({ ok: true, data: { kind: 'article' } });
    expect(tabsQuery).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(tabsSendMessage).toHaveBeenCalledWith(20, { type: 'getCurrentPageCaptureState' });
  });

  it('never falls back to an unrelated window if the last-focused window is unavailable', async () => {
    vi.mocked(tabsQuery).mockImplementation(async (query: any) =>
      query.lastFocusedWindow ? [] : [{ id: 2232, url: 'https://chatgpt.com/c/other' }],
    );
    const response = await createTestBackgroundRouter().dispatch({ type: 'captureActiveTabCurrentPage' });
    expect(response).toMatchObject({ ok: false, error: { extra: { code: 'CAPTURE_UNAVAILABLE' } } });
    expect(tabsSendMessage).not.toHaveBeenCalled();
  });
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
