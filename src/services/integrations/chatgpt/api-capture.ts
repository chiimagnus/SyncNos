import { parseChatgptDurableConversationRoute } from '@services/shared/chatgpt-route';
import { CHATGPT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { sendMessage } from '@platform/runtime/runtime';
import { buildChatgptApiSnapshot, type ChatgptApiSnapshotResult } from '@services/integrations/chatgpt/api-snapshot';

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
  try {
    return await fetchPage(request);
  } catch (error) {
    if (!isRetryableFetchError(error)) throw error;
    return fetchPage(request);
  }
}

function currentNodeSignature(message: any): string {
  return JSON.stringify([
    message?.content,
    message?.status,
    message?.end_turn,
    message?.metadata?.is_complete,
    message?.metadata?.parent_id,
  ]);
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
  onPage?: (result: ChatgptApiSnapshotResult) => Promise<void>;
}): Promise<CaptureResult> {
  const readCurrentUrl = input?.readCurrentUrl || (() => String(globalThis.location?.href || ''));
  const fetchPage = input?.requestPage || requestPageThroughBackground;
  const timeoutMs = Math.max(1, Number(input?.timeoutMs) || 30_000);
  const initialUrl = readCurrentUrl();
  const route = parseChatgptDurableConversationRoute(initialUrl);
  if (!route) throw apiCaptureError('chatgpt_api_navigation_changed');

  const retained: any[] = [];
  const seenIds = new Set<string>();
  const stagedContent = new Map<string, string>();
  const childByParent = new Map<string, string>();
  let hasAlternateBranches = false;
  let cursor = '';
  let title = '';
  let currentNode = '';
  let capturedNodeSignature = '';
  let currentNodeInProgress = false;

  const assertRoute = () => {
    if (parseChatgptDurableConversationRoute(readCurrentUrl())?.conversationId !== route.conversationId) {
      throw apiCaptureError('chatgpt_api_navigation_changed');
    }
  };
  const latestMatches = async (): Promise<boolean> => {
    assertRoute();
    const head = await requestPageWithRetry(
      { conversationId: route.conversationId, numTurns: 1, timeoutMs },
      fetchPage,
    );
    assertRoute();
    if (head?.conversation_id !== route.conversationId || typeof head.current_node !== 'string' || !head.current_node) {
      throw apiCaptureError('chatgpt_api_conversation_identity');
    }
    if (head.current_node !== currentNode) return false;
    if (!Array.isArray(head.messages)) throw apiCaptureError('chatgpt_api_page_schema');
    const currentMessage = head.messages.find((message: any) => message?.id === currentNode);
    if (!currentMessage) throw apiCaptureError('chatgpt_api_page_schema');
    return currentNodeSignature(currentMessage) === capturedNodeSignature;
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
      const latest = messages.at(-1);
      capturedNodeSignature = currentNodeSignature(latest);
      currentNodeInProgress =
        latest?.status === 'in_progress' || latest?.status === 'streaming' || latest?.metadata?.is_complete === false;
    }

    const firstId = messages[0]?.id;
    const lastId = messages.at(-1)?.id;
    if (!firstId || !lastId || pageInfo.start_cursor !== firstId || pageInfo.end_cursor !== lastId) {
      throw apiCaptureError('chatgpt_api_page_cursor_invalid');
    }
    for (const message of messages) {
      const id = message?.id;
      if (typeof id !== 'string' || !id || seenIds.has(id)) {
        throw apiCaptureError('chatgpt_api_page_duplicate_id');
      }
      seenIds.add(id);
      const parent = message?.metadata?.parent_id;
      if (typeof parent === 'string' && parent) {
        const sibling = childByParent.get(parent);
        if (sibling && sibling !== id) hasAlternateBranches = true;
        childByParent.set(parent, id);
      }
    }
    const visible = messages.filter(retainForRendering);
    if (page === 0 && !visible.some((message: any) => message.id === currentNode)) {
      visible.push(messages.at(-1));
    }
    retained.unshift(...visible);
    const completed = pageInfo.has_previous_page === false;
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
    let result: ChatgptApiSnapshotResult;
    try {
      result = buildChatgptApiSnapshot({
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
    } catch (error) {
      // Commentary without a stable owner may only become saveable after older pages arrive.
      if (!completed && (error as any)?.code === 'no_visible_messages') {
        cursor = firstId;
        continue;
      }
      throw error;
    }
    // Partial snapshots can only append; a head fetch is needed only before a possible complete replacement.
    const changedWhileFetching =
      completed &&
      !currentNodeInProgress &&
      !hasAlternateBranches &&
      result.snapshot.captureMeta.completeness === 'complete' &&
      !(await latestMatches());
    if (!completed || currentNodeInProgress || hasAlternateBranches || changedWhileFetching) {
      const meta = result.snapshot.captureMeta;
      result.snapshot.captureMeta = {
        ...meta,
        completeness: 'partial',
        reasons: Array.from(
          new Set([
            ...(meta.reasons || []),
            ...(!completed ? ['chatgpt_api_paging'] : []),
            ...(currentNodeInProgress ? ['chatgpt_api_unfinished_turn_partial'] : []),
            ...(hasAlternateBranches ? ['chatgpt_api_branch_ambiguous'] : []),
            ...(changedWhileFetching ? ['chatgpt_api_conversation_changed'] : []),
          ]),
        ),
      };
    }
    if (input?.onPage) {
      const messages = result.snapshot.messages as Array<{ messageKey: string; contentMarkdown: string }>;
      const toStage = new Set<string>();
      for (const message of messages) {
        if (stagedContent.get(message.messageKey) !== message.contentMarkdown) toStage.add(message.messageKey);
      }
      // Keep adjacent stored keys as order anchors when newly discovered older messages are prepended.
      for (let index = 0; index < messages.length; index += 1) {
        const key = messages[index]!.messageKey;
        if (stagedContent.has(key)) continue;
        if (index > 0 && stagedContent.has(messages[index - 1]!.messageKey))
          toStage.add(messages[index - 1]!.messageKey);
        if (index + 1 < messages.length && stagedContent.has(messages[index + 1]!.messageKey))
          toStage.add(messages[index + 1]!.messageKey);
      }
      if (toStage.size) {
        const batch = messages.filter((message) => toStage.has(message.messageKey));
        await input.onPage({ snapshot: { ...result.snapshot, messages: batch } });
        for (const message of batch) stagedContent.set(message.messageKey, message.contentMarkdown);
      }
    }
    if (completed) {
      assertRoute();
      return {
        ...result,
        verifyCurrent: async () => {
          if (!(await latestMatches())) throw apiCaptureError('chatgpt_api_conversation_changed');
        },
      };
    }
    cursor = firstId;
  }
}
