import { CHATGPT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { scriptingExecuteScript } from '@platform/webext/scripting';
import { fetchChatgptPageInMainWorld } from '@services/integrations/chatgpt/api-main-fetch';
import { parseChatgptDurableConversationRoute } from '@services/shared/chatgpt-route';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any, sender: any) => Promise<any> | any) => void;
};

export function registerChatgptApiHandlers(router: AnyRouter): void {
  router.register(CHATGPT_MESSAGE_TYPES.FETCH_API_PAGE, async (msg, sender) => {
    const conversationId = String(msg?.conversationId || '').trim();
    const tabId = Number(sender?.tab?.id);
    const senderRoute = parseChatgptDurableConversationRoute(sender?.url);
    const tabRoute = parseChatgptDurableConversationRoute(sender?.tab?.url);
    if (
      !conversationId ||
      !Number.isSafeInteger(tabId) ||
      tabId < 0 ||
      senderRoute?.conversationId !== conversationId ||
      tabRoute?.conversationId !== conversationId
    ) {
      return router.err('chatgpt_api_navigation_changed');
    }
    const before = String(msg?.before || '');
    if (before && !/^[0-9a-zA-Z_-]+$/.test(before)) return router.err('chatgpt_api_page_cursor_invalid');
    const numTurns = msg?.numTurns === 1 ? 1 : 10;
    const timeoutMs = Math.min(60_000, Math.max(1, Number(msg?.timeoutMs) || 30_000));

    let results: any[];
    try {
      results = await scriptingExecuteScript({
        target: { tabId, allFrames: false },
        world: 'MAIN',
        func: fetchChatgptPageInMainWorld,
        args: [{ conversationId, before, numTurns, timeoutMs }],
      });
    } catch (_error) {
      return router.err('chatgpt_api_page_network');
    }
    const result = results[0]?.result;
    if (result?.ok === true && result.data && typeof result.data === 'object') {
      return router.ok(result.data);
    }
    const code = String(result?.code || 'chatgpt_api_page_schema');
    const status = Number(result?.status || 0);
    return router.err(code, { code, ...(status ? { status } : null) });
  });
}
