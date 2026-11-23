import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  tabsQuery: vi.fn(),
  sendToContentScript: vi.fn(),
  findSavedConversationForPage: vi.fn(),
}));
vi.mock('@platform/webext/tabs', () => ({ tabsQuery: deps.tabsQuery }));
vi.mock('@platform/messaging/content-script-recovery', () => ({ sendToContentScript: deps.sendToContentScript }));

import { registerUiMessageHandlers } from '@platform/messaging/ui-background-handlers';
import { UI_MESSAGE_TYPES } from '@platform/messaging/message-contracts';

function createStateHandler() {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  registerUiMessageHandlers(
    {
      register: (type: string, handler: (...args: any[]) => Promise<any>) => handlers.set(type, handler),
      ok: (data: unknown) => ({ ok: true, data, error: null }),
      err: (message: string, extra?: unknown) => ({ ok: false, data: null, error: { message, extra } }),
    },
    { ensureLocaleReady: async () => undefined, findSavedConversationForPage: deps.findSavedConversationForPage },
  );
  return handlers.get(UI_MESSAGE_TYPES.GET_ACTIVE_TAB_CAPTURE_STATE)!;
}

beforeEach(() => {
  vi.resetAllMocks();
  deps.tabsQuery.mockResolvedValue([{ id: 12, url: 'https://chatgpt.com/c/stale', windowId: 3 }]);
  deps.findSavedConversationForPage.mockResolvedValue(null);
});

describe('saved page state through the popup relay', () => {
  it('matches the actual content page URL after SPA navigation and returns the stored locator', async () => {
    deps.sendToContentScript.mockResolvedValue({
      ok: true,
      data: {
        kind: 'chat',
        collectorId: 'chatgpt',
        label: 'Fetch AI Chat',
        pageUrl: 'https://chatgpt.com/c/current',
      },
    });
    deps.findSavedConversationForPage.mockResolvedValue({
      id: 78,
      source: 'chatgpt',
      conversationKey: 'migrated-stored-key',
    });
    const result = await createStateHandler()();
    expect(deps.tabsQuery).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(deps.sendToContentScript).toHaveBeenCalledWith(12, { type: 'getCurrentPageCaptureState' });
    expect(deps.findSavedConversationForPage).toHaveBeenCalledWith('chatgpt', 'https://chatgpt.com/c/current');
    expect(result).toEqual({
      ok: true,
      data: {
        kind: 'chat',
        collectorId: 'chatgpt',
        label: 'Fetch AI Chat',
        savedConversation: {
          id: 78,
          source: 'chatgpt',
          conversationKey: 'migrated-stored-key',
        },
      },
      error: null,
    });
  });

  it('re-reads storage on every request so saved status clears after deletion', async () => {
    deps.sendToContentScript.mockResolvedValue({
      ok: true,
      data: { kind: 'article', collectorId: 'web', label: 'Fetch Article', pageUrl: 'https://example.com/a' },
    });
    deps.findSavedConversationForPage
      .mockResolvedValueOnce({ id: 9, source: 'web', conversationKey: 'article:https://example.com/a' })
      .mockResolvedValueOnce(null);
    const handle = createStateHandler();
    expect((await handle()).data.savedConversation).toMatchObject({ id: 9 });
    expect((await handle()).data.savedConversation).toBeUndefined();
    expect(deps.findSavedConversationForPage).toHaveBeenCalledTimes(2);
  });

  it('preserves capture availability and activity when not saved and hides internal page URL', async () => {
    deps.sendToContentScript.mockResolvedValue({
      ok: true,
      data: {
        kind: 'unsupported',
        collectorId: 'web',
        label: 'Unavailable',
        reason: 'No readable content',
        pageUrl: 'https://example.com/page',
        activity: { phase: 'settled', kind: 'error', message: 'Capture failed', expiresAt: 90 },
      },
    });
    const result = await createStateHandler()();
    expect(result.data).toMatchObject({
      kind: 'unsupported',
      collectorId: 'web',
      activity: { kind: 'error' },
    });
    expect(result.data).not.toHaveProperty('pageUrl');
    expect(result.data).not.toHaveProperty('savedConversation');
  });

  it('does not query storage for unsupported tabs or identity-free capture responses', async () => {
    const handle = createStateHandler();
    deps.sendToContentScript.mockResolvedValue({
      ok: true,
      data: { kind: 'unsupported', collectorId: null, pageUrl: 'https://example.com/page' },
    });
    expect((await handle()).data.savedConversation).toBeUndefined();
    expect(deps.findSavedConversationForPage).not.toHaveBeenCalled();
    deps.tabsQuery.mockResolvedValue([{ id: 12, url: 'chrome://extensions/' }]);
    await handle();
    expect(deps.sendToContentScript).toHaveBeenCalledTimes(1);
  });

  it('does not turn a storage read error into a false negative', async () => {
    deps.sendToContentScript.mockResolvedValue({
      ok: true,
      data: { kind: 'article', collectorId: 'web', pageUrl: 'https://example.com/record' },
    });
    deps.findSavedConversationForPage.mockRejectedValue(new Error('indexedDB unavailable'));
    await expect(createStateHandler()()).rejects.toThrow('indexedDB unavailable');
  });
});
