import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { CHATGPT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { fetchChatgptPageInMainWorld } from '@services/integrations/chatgpt/api-main-fetch';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@platform/webext/scripting', () => ({ scriptingExecuteScript: mocks.execute }));

import { registerChatgptApiHandlers } from '@services/integrations/chatgpt/api-background-handlers';

const sender = {
  url: 'https://chatgpt.com/c/conversation-1',
  tab: { id: 77, url: 'https://chatgpt.com/c/conversation-1' },
};

function router() {
  const r = createBackgroundRouter({ fallback: (msg: any) => ({ ok: false, error: { message: msg.type } }) });
  registerChatgptApiHandlers(r);
  return r;
}

beforeEach(() => mocks.execute.mockReset());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChatGPT paged API background transport', () => {
  it('runs the authenticated request in the originating page MAIN world, not in the isolated content script', async () => {
    mocks.execute.mockResolvedValue([
      { result: { ok: true, data: { conversation_id: 'conversation-1', messages: [] } } },
    ]);
    const result = await router().dispatch(
      {
        type: CHATGPT_MESSAGE_TYPES.FETCH_API_PAGE,
        conversationId: 'conversation-1',
        numTurns: 10,
        timeoutMs: 30_000,
      },
      sender,
    );
    expect(result.ok).toBe(true);
    expect(mocks.execute).toHaveBeenCalledWith({
      target: { tabId: 77, allFrames: false },
      world: 'MAIN',
      func: fetchChatgptPageInMainWorld,
      args: [{ conversationId: 'conversation-1', before: '', numTurns: 10, timeoutMs: 30_000 }],
    });
  });

  it.each([
    ['home to chat', 'https://chatgpt.com/', 'https://chatgpt.com/c/conversation-1'],
    ['chat to chat', 'https://chatgpt.com/c/previous', 'https://chatgpt.com/c/conversation-1'],
    ['chat to project chat', 'https://chatgpt.com/c/previous', 'https://chatgpt.com/g/project/c/conversation-1'],
    ['project chat to chat', 'https://chatgpt.com/g/project/c/previous', 'https://chatgpt.com/c/conversation-1'],
    [
      'project chat to project chat',
      'https://chatgpt.com/g/project/c/previous',
      'https://chatgpt.com/g/project/c/conversation-1',
    ],
    [
      'back to chat with query and hash',
      'https://chatgpt.com/c/previous',
      'https://chatgpt.com/c/conversation-1?mode=chat#end',
    ],
    ['home to project chat', 'https://chatgpt.com/', 'https://chatgpt.com/g/project/c/conversation-1'],
  ])(
    'allows a valid SPA navigation from %s even when the sender document URL is stale',
    async (_case, documentUrl, activeUrl) => {
      mocks.execute.mockResolvedValue([{ result: { ok: true, data: { conversation_id: 'conversation-1' } } }]);
      const result = await router().dispatch(
        { type: CHATGPT_MESSAGE_TYPES.FETCH_API_PAGE, conversationId: 'conversation-1' },
        {
          ...sender,
          origin: 'https://chatgpt.com',
          frameId: 0,
          url: documentUrl,
          tab: { ...sender.tab, url: activeUrl },
        },
      );
      expect(result.ok).toBe(true);
      expect(mocks.execute).toHaveBeenCalledOnce();
    },
  );

  it('accepts a stale sender URL when the browser does not provide the optional origin field', async () => {
    mocks.execute.mockResolvedValue([{ result: { ok: true, data: { conversation_id: 'conversation-1' } } }]);
    const result = await router().dispatch(
      { type: CHATGPT_MESSAGE_TYPES.FETCH_API_PAGE, conversationId: 'conversation-1' },
      { ...sender, url: 'https://chatgpt.com/', tab: { ...sender.tab } },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects foreign origins, non-top-level frames, stale tab routes and invalid tab identities before injection', async () => {
    const invalidSenders = [
      null,
      { ...sender, url: 'https://evil.example/c/conversation-1' },
      { ...sender, url: 'https://chatgpt.com.evil.example/c/conversation-1' },
      { ...sender, url: 'http://chatgpt.com/c/conversation-1' },
      { ...sender, url: 'not-a-url' },
      { ...sender, origin: 'https://evil.example' },
      { ...sender, origin: 'null' },
      { ...sender, origin: 'https://chatgpt.com', url: 'https://evil.example/c/conversation-1' },
      { ...sender, frameId: 1 },
      { ...sender, frameId: -1 },
      { ...sender, tab: { id: 77, url: 'https://chatgpt.com/c/other' } },
      { ...sender, tab: { id: 77, url: 'https://chatgpt.com/g/project/c/other' } },
      { ...sender, tab: { id: 77, url: 'https://chatgpt.com/' } },
      { ...sender, tab: { id: 77, url: 'https://chatgpt.com/share/other' } },
      { ...sender, tab: { id: 77, url: 'https://evil.example/c/conversation-1' } },
      { ...sender, tab: { id: -1, url: sender.tab.url } },
      { ...sender, tab: { id: Number.MAX_SAFE_INTEGER + 1, url: sender.tab.url } },
      { ...sender, tab: null },
    ];
    for (const bad of invalidSenders) {
      const result = await router().dispatch(
        {
          type: CHATGPT_MESSAGE_TYPES.FETCH_API_PAGE,
          conversationId: 'conversation-1',
        },
        bad,
      );
      expect(result).toMatchObject({ ok: false, error: { message: 'chatgpt_api_navigation_changed' } });
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('rejects a true mid-flight navigation in the MAIN world even after background identity checks pass', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    vi.stubGlobal('location', { origin: 'https://chatgpt.com', pathname: '/c/other' });
    mocks.execute.mockImplementation(async ({ func, args }) => [{ result: await func(args[0]) }]);

    const result = await router().dispatch(
      { type: CHATGPT_MESSAGE_TYPES.FETCH_API_PAGE, conversationId: 'conversation-1' },
      { ...sender, origin: 'https://chatgpt.com', frameId: 0 },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'chatgpt_api_navigation_changed', extra: { code: 'chatgpt_api_navigation_changed' } },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('passes a cursor only after local validation and returns structured error codes', async () => {
    const invalid = await router().dispatch(
      {
        type: CHATGPT_MESSAGE_TYPES.FETCH_API_PAGE,
        conversationId: 'conversation-1',
        before: '../escape',
      },
      sender,
    );
    expect(invalid).toMatchObject({ ok: false, error: { message: 'chatgpt_api_page_cursor_invalid' } });
    expect(mocks.execute).not.toHaveBeenCalled();

    mocks.execute.mockResolvedValue([{ result: { ok: false, code: 'chatgpt_api_page_http', status: 429 } }]);
    const res = await router().dispatch(
      {
        type: CHATGPT_MESSAGE_TYPES.FETCH_API_PAGE,
        conversationId: 'conversation-1',
        before: 'cursor-1',
        numTurns: 10,
      },
      sender,
    );
    expect(res).toMatchObject({
      ok: false,
      error: { message: 'chatgpt_api_page_http', extra: { code: 'chatgpt_api_page_http', status: 429 } },
    });
  });

  it('does not expose scripting errors or access tokens through the background response', async () => {
    mocks.execute.mockRejectedValue(new Error('PRIVATE_PAGE_TOKEN'));
    const result = await router().dispatch(
      {
        type: CHATGPT_MESSAGE_TYPES.FETCH_API_PAGE,
        conversationId: 'conversation-1',
      },
      sender,
    );
    expect(result).toMatchObject({ ok: false, error: { message: 'chatgpt_api_page_network' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PAGE_TOKEN');
  });
});
