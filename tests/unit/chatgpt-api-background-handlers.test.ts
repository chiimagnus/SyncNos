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
afterEach(() => vi.restoreAllMocks());

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

  it('rejects messages not sent from the matching ChatGPT page, including a forged tab identity', async () => {
    const invalidSenders = [
      null,
      { ...sender, url: 'https://evil.example/c/conversation-1' },
      { ...sender, tab: { id: 77, url: 'https://chatgpt.com/c/other' } },
      { ...sender, tab: { id: -1, url: sender.tab.url } },
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
