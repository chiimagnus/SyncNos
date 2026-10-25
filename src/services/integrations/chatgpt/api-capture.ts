import { parseChatgptDurableConversationRoute } from '@services/shared/chatgpt-route';
import { CHATGPT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { sendMessage } from '@platform/runtime/runtime';
import { buildChatgptApiSnapshot, type ChatgptApiSnapshotResult } from '@services/integrations/chatgpt/api-snapshot';

type PageProgress = { page: number; completed: boolean; messagesFetched: number };
type CaptureResult = ChatgptApiSnapshotResult & { verifyCurrent: () => Promise<void> };
type PageRequest = { conversationId: string; before?: string; numTurns: number; timeoutMs: number };

function apiCaptureError(code: string, status?: number): Error & { code: string; status?: number } {
  return Object.assign(new Error(code), { code, ...(status ? { status } : null) });
}

function isRetryableFetchError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const status = Number((error as any)?.status || 0);
  return code.endsWith('_network') || code.endsWith('_timeout') || status === 408 || status === 425 || status >= 500;
}

async function requestPageThroughBackground(request: PageRequest): Promise<any> {
  let response: any;
  try {
    response = await sendMessage(
      {
        type: CHATGPT_MESSAGE_TYPES.FETCH_API_PAGE,
        ...request,
      },
      { timeoutMs: request.timeoutMs * 2 + 10_000 },
    );
  } catch (_error) {
    throw apiCaptureError('chatgpt_api_page_network');
  }
  if (response?.ok !== true) {
    const error = response?.error;
    throw apiCaptureError(
      String(error?.extra?.code || error?.message || 'chatgpt_api_page_network'),
      Number(error?.extra?.status || 0),
    );
  }
  return response.data;
}

async function requestPageWithRetry(
  request: PageRequest,
  fetchPage: (request: PageRequest) => Promise<any>,
): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchPage(request);
    } catch (error) {
      if (attempt || !isRetryableFetchError(error)) throw error;
    }
  }
  throw apiCaptureError('chatgpt_api_page_network');
}

function sanitizedConversationUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.search = '';
  url.hash = '';
  return url.href;
}

function retainForRendering(message: any): boolean {
  const role = message?.author?.role;
  return (
    role === 'user' ||
    (role === 'assistant' && message?.recipient === 'all') ||
    (role === 'tool' && typeof message?.metadata?.image_gen_title === 'string')
  );
}

export async function captureCurrentChatgptConversationViaApi(input?: {
  readCurrentUrl?: () => string;
  requestPage?: (request: PageRequest) => Promise<any>;
  timeoutMs?: number;
  capturedAt?: number;
  onPage?: (result: ChatgptApiSnapshotResult, progress: PageProgress) => Promise<void>;
}): Promise<CaptureResult> {
  const readCurrentUrl = input?.readCurrentUrl || (() => String(globalThis.location?.href || ''));
  const fetchPage = input?.requestPage || requestPageThroughBackground;
  const timeoutMs = Math.max(1, Number(input?.timeoutMs) || 30_000);
  const initialUrl = readCurrentUrl();
  const route = parseChatgptDurableConversationRoute(initialUrl);
  if (!route) throw apiCaptureError('chatgpt_api_navigation_changed');

  const retained: any[] = [];
  const seenIds = new Set<string>();
  const childByParent = new Map<string, string>();
  let hasAlternateBranches = false;
  let cursor = '';
  let title = '';
  let currentNode = '';
  let lastResult: ChatgptApiSnapshotResult | null = null;
  let completed = false;

  const assertRoute = () => {
    if (parseChatgptDurableConversationRoute(readCurrentUrl())?.conversationId !== route.conversationId) {
      throw apiCaptureError('chatgpt_api_navigation_changed');
    }
  };
  const latestNode = async (): Promise<string> => {
    assertRoute();
    const head = await requestPageWithRetry(
      { conversationId: route.conversationId, numTurns: 1, timeoutMs },
      fetchPage,
    );
    assertRoute();
    if (head?.conversation_id !== route.conversationId || typeof head.current_node !== 'string' || !head.current_node) {
      throw apiCaptureError('chatgpt_api_conversation_identity');
    }
    return head.current_node;
  };
  for (let page = 0; ; page += 1) {
    assertRoute();
    const data = await requestPageWithRetry(
      {
        conversationId: route.conversationId,
        ...(page ? { before: cursor } : null),
        numTurns: 10,
        timeoutMs,
      },
      fetchPage,
    );
    assertRoute();

    const messages = data?.messages;
    const pageInfo = data?.page_info;
    if (!Array.isArray(messages) || !messages.length || !pageInfo || typeof pageInfo.has_previous_page !== 'boolean') {
      throw apiCaptureError('chatgpt_api_page_schema');
    }
    if (page === 0) {
      if (data.conversation_id !== route.conversationId) throw apiCaptureError('chatgpt_api_conversation_identity');
      title = typeof data.title === 'string' ? data.title : 'ChatGPT';
      currentNode = String(data.current_node || '');
      if (!currentNode || currentNode !== messages.at(-1)?.id)
        throw apiCaptureError('chatgpt_api_current_node_invalid');
    }

    const firstId = messages[0]?.id;
    const lastId = messages.at(-1)?.id;
    if (!firstId || !lastId || pageInfo.start_cursor !== firstId || pageInfo.end_cursor !== lastId) {
      throw apiCaptureError('chatgpt_api_page_cursor_invalid');
    }
    const pageIds = new Set<string>();
    for (const message of messages) {
      const id = message?.id;
      if (typeof id !== 'string' || !id || pageIds.has(id) || seenIds.has(id)) {
        throw apiCaptureError('chatgpt_api_page_duplicate_id');
      }
      pageIds.add(id);
      const parent = message?.metadata?.parent_id;
      if (typeof parent === 'string' && parent) {
        const sibling = childByParent.get(parent);
        if (sibling && sibling !== id) hasAlternateBranches = true;
        childByParent.set(parent, id);
      }
    }
    for (const id of pageIds) seenIds.add(id);

    const visible = messages.filter(retainForRendering);
    if (page === 0 && !visible.some((message: any) => message.id === currentNode)) {
      visible.push(messages.at(-1));
    }
    retained.unshift(...visible);
    completed = pageInfo.has_previous_page === false;
    if (
      !retained.some(
        (message) =>
          message?.metadata?.is_visually_hidden_from_conversation !== true &&
          (message?.author?.role === 'user' || (message?.author?.role === 'assistant' && message?.recipient === 'all')),
      )
    ) {
      if (completed) throw apiCaptureError('chatgpt_api_no_visible_messages');
      cursor = firstId;
      continue;
    }
    const changedWhileFetching = completed && (await latestNode()) !== currentNode;
    const result = buildChatgptApiSnapshot({
      data: {
        conversation_id: route.conversationId,
        title,
        current_node: retained.at(-1)?.id,
        messages: retained,
      },
      conversationId: route.conversationId,
      conversationUrl: sanitizedConversationUrl(initialUrl),
      capturedAt: input?.capturedAt,
    });
    if (!completed || hasAlternateBranches || changedWhileFetching) {
      const meta = result.snapshot.captureMeta;
      result.snapshot.captureMeta = {
        ...meta,
        completeness: 'partial',
        reasons: Array.from(
          new Set([
            ...(meta.reasons || []),
            ...(!completed ? ['chatgpt_api_paging'] : []),
            ...(hasAlternateBranches ? ['chatgpt_api_branch_ambiguous'] : []),
            ...(changedWhileFetching ? ['chatgpt_api_conversation_changed'] : []),
          ]),
        ),
      };
    }
    await input?.onPage?.(result, { page: page + 1, completed, messagesFetched: seenIds.size });
    lastResult = result;
    if (completed) break;
    if (cursor === firstId) throw apiCaptureError('chatgpt_api_page_cursor_invalid');
    cursor = firstId;
  }

  if (!lastResult) throw apiCaptureError('chatgpt_api_no_visible_messages');
  assertRoute();
  return {
    ...lastResult,
    verifyCurrent: async () => {
      if ((await latestNode()) !== currentNode) throw apiCaptureError('chatgpt_api_conversation_changed');
    },
  };
}
