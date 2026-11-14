import { parseChatgptDurableConversationRoute } from '@services/shared/chatgpt-route';
import { CHATGPT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { sendMessage } from '@platform/runtime/runtime';
import { buildChatgptApiSnapshot, type ChatgptApiSnapshotResult } from '@services/integrations/chatgpt/api-snapshot';
import type { ChatgptApiCheckpoint } from '@services/conversations/domain/models';

type CaptureResult = ChatgptApiSnapshotResult & {
  verifyCurrent: () => Promise<void>;
  checkpoint: ChatgptApiCheckpoint | null;
  verifiedTail?: true;
};
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

async function userSignature(markdown: string, parentId: unknown): Promise<string> {
  const normalizedParent = typeof parentId === 'string' ? parentId : '';
  const bytes = new TextEncoder().encode(JSON.stringify([markdown, normalizedParent]));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function latestUserCheckpoint(
  messages: readonly any[],
  rawNodes: readonly any[],
  includeThinking: boolean,
): Promise<ChatgptApiCheckpoint | null> {
  const user = messages.findLast((message) => message?.role === 'user');
  if (!user?.messageKey) return null;
  const rawUser = rawNodes.findLast((message) => message?.id === user.messageKey);
  if (!rawUser) return null;
  return {
    lastUserKey: user.messageKey,
    userSignature: await userSignature(String(user.contentMarkdown || ''), rawUser.metadata?.parent_id),
    includeThinking,
  };
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
  includeThinking?: boolean;
  trustedCheckpoint?: ChatgptApiCheckpoint;
  trustedTailLastAssistantKey?: string;
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
  const parentById = new Map<string, string>();
  let hasAlternateBranches = false;
  let cursor = '';
  let title = '';
  let currentNode = '';
  let capturedNodeSignature = '';
  let currentNodeInProgress = false;
  let candidateStage: ChatgptApiSnapshotResult | null = null;

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
    let data: any;
    try {
      data = await requestPageWithRetry(
        {
          conversationId: route.conversationId,
          ...(page ? { before: cursor } : null),
          numTurns: 10,
          timeoutMs,
        },
        fetchPage,
      );
    } catch (error) {
      if (candidateStage && input?.onPage) {
        const meta = candidateStage.snapshot.captureMeta;
        await input.onPage({
          snapshot: {
            ...candidateStage.snapshot,
            captureMeta: {
              ...meta,
              completeness: 'partial',
              reasons: Array.from(new Set([...(meta.reasons || []), 'chatgpt_api_paging'])),
            },
          },
        });
      }
      throw error;
    }
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
        parentById.set(id, parent);
      }
    }
    const visible = messages.filter(retainForRendering);
    if (page === 0 && !visible.some((message: any) => message.id === currentNode)) {
      visible.push(messages.at(-1));
    }
    retained.unshift(...visible);
    const completed = pageInfo.has_previous_page === false;
    const selectedAncestorsTo = (target: string): Set<string> | null => {
      const ancestors = new Set<string>();
      let id = currentNode;
      while (seenIds.has(id) && !ancestors.has(id)) {
        ancestors.add(id);
        if (id === target) return ancestors;
        id = parentById.get(id) || '';
      }
      return null;
    };
    const trustedAnchor = input?.trustedCheckpoint?.lastUserKey;
    const selectedTail = trustedAnchor && seenIds.has(trustedAnchor) ? selectedAncestorsTo(trustedAnchor) : null;
    let unresolvedBranches = hasAlternateBranches;
    let renderMessages = retained;
    if (hasAlternateBranches && completed) {
      const chain = new Set<string>();
      let node = currentNode;
      while (seenIds.has(node) && !chain.has(node)) {
        chain.add(node);
        const parent = parentById.get(node);
        if (!parent) break;
        node = parent;
      }
      const userIds = new Set(
        retained.filter((message) => message?.author?.role === 'user').map((message) => message.id),
      );
      const rootUser = Array.from(chain)
        .reverse()
        .find((id) => userIds.has(id));
      const selected = rootUser ? selectedAncestorsTo(rootUser) : null;
      if (selected) {
        const selectedParents = new Set(Array.from(selected, (id) => parentById.get(id)).filter(Boolean));
        const excludedIsAlternate = (message: any): boolean => {
          let id = message.id;
          const visited = new Set<string>();
          while (id && !visited.has(id)) {
            visited.add(id);
            const parent = parentById.get(id);
            if (!parent) return false;
            if (selected.has(parent) || selectedParents.has(parent)) return true;
            id = parent;
          }
          return false;
        };
        if (retained.every((message) => selected.has(message.id) || excludedIsAlternate(message))) {
          renderMessages = retained.filter((message) => selected.has(message.id));
          unresolvedBranches = false;
        }
      }
    }
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
          current_node: renderMessages.at(-1)?.id,
          messages: renderMessages,
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
    const savedUserKey = input?.trustedCheckpoint?.lastUserKey;
    const projected = result.snapshot.messages;
    const savedUserIndex = projected.findIndex(
      (message: any) => message.role === 'user' && message.messageKey === savedUserKey,
    );
    const newestUserIndex = projected.findLastIndex((message: any) => message.role === 'user');
    const lastSavedAssistantIndex = projected.findIndex(
      (message: any) => message.role === 'assistant' && message.messageKey === input?.trustedTailLastAssistantKey,
    );
    const linearOverlap =
      !hasAlternateBranches &&
      savedUserIndex >= 0 &&
      (savedUserIndex === newestUserIndex ||
        (lastSavedAssistantIndex > savedUserIndex && lastSavedAssistantIndex < newestUserIndex));
    if (input?.trustedCheckpoint && (selectedTail || linearOverlap)) {
      // ChatGPT's selected-branch pages can omit parent links inside tool-heavy turns.
      // A matching final user or a saved assistant before newer users provides bounded overlap.
      const scopedMessages = selectedTail
        ? retained.filter((message) => selectedTail.has(message.id))
        : retained.slice(retained.findIndex((message) => message.id === savedUserKey));
      const scopedResult = buildChatgptApiSnapshot({
        data: {
          conversation_id: route.conversationId,
          title,
          current_node: scopedMessages.at(-1)?.id,
          messages: scopedMessages,
        },
        conversationId: route.conversationId,
        conversationUrl: sanitizedConversationUrl(initialUrl),
        capturedAt: input?.capturedAt,
      });
      const checkpointUser = scopedResult.snapshot.messages.find(
        (message: any) => message.role === 'user' && message.messageKey === input.trustedCheckpoint!.lastUserKey,
      );
      const rawUser = checkpointUser && retained.find((message) => message.id === checkpointUser.messageKey);
      if (
        checkpointUser &&
        rawUser &&
        input.trustedCheckpoint.includeThinking === (input?.includeThinking !== false) &&
        (await userSignature(String(checkpointUser.contentMarkdown || ''), rawUser.metadata?.parent_id)) ===
          input.trustedCheckpoint.userSignature
      ) {
        const stableTail = scopedResult.snapshot.captureMeta.completeness === 'complete' && !currentNodeInProgress;
        if (!stableTail || (await latestMatches())) {
          assertRoute();
          result = scopedResult;
          if (!stableTail) {
            const meta = result.snapshot.captureMeta;
            result.snapshot.captureMeta = {
              ...meta,
              completeness: 'partial',
              reasons: Array.from(new Set([...(meta.reasons || []), 'chatgpt_api_unfinished_turn_partial'])),
            };
          }
          const checkpoint = stableTail
            ? await latestUserCheckpoint(result.snapshot.messages, retained, input?.includeThinking !== false)
            : null;
          return {
            ...result,
            verifiedTail: true,
            checkpoint,
            verifyCurrent: async () => {
              if (!(await latestMatches())) throw apiCaptureError('chatgpt_api_conversation_changed');
            },
          };
        }
      }
    }
    if (input?.trustedCheckpoint && !unresolvedBranches) candidateStage = result;
    // Partial snapshots can only append; a head fetch is needed only before a possible complete replacement.
    const changedWhileFetching =
      completed &&
      !currentNodeInProgress &&
      !unresolvedBranches &&
      result.snapshot.captureMeta.completeness === 'complete' &&
      !(await latestMatches());
    if (!completed || currentNodeInProgress || unresolvedBranches || changedWhileFetching) {
      const meta = result.snapshot.captureMeta;
      result.snapshot.captureMeta = {
        ...meta,
        completeness: 'partial',
        reasons: Array.from(
          new Set([
            ...(meta.reasons || []),
            ...(!completed ? ['chatgpt_api_paging'] : []),
            ...(currentNodeInProgress ? ['chatgpt_api_unfinished_turn_partial'] : []),
            ...(unresolvedBranches ? ['chatgpt_api_branch_ambiguous'] : []),
            ...(changedWhileFetching ? ['chatgpt_api_conversation_changed'] : []),
          ]),
        ),
      };
    }
    if (input?.onPage && (!input.trustedCheckpoint || completed)) {
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
      const checkpoint =
        result.snapshot.captureMeta.completeness === 'complete'
          ? await latestUserCheckpoint(result.snapshot.messages, retained, input?.includeThinking !== false)
          : null;
      return {
        ...result,
        checkpoint,
        verifyCurrent: async () => {
          if (!(await latestMatches())) throw apiCaptureError('chatgpt_api_conversation_changed');
        },
      };
    }
    cursor = firstId;
  }
}
