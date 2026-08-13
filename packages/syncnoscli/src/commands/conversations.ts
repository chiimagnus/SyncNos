import { type CliFactsRequest } from '@services/local-data/contracts';

import {
  createSqliteConversationListScope,
  createConversationsRepository,
  decodeSqliteConversationListCursor,
  encodeSqliteConversationListCursor,
} from '../sqlite/conversations-repository';
import { openReadOnly, type DatabaseOpenInput } from '../sqlite/database';
import { createMessagesRepository } from '../sqlite/messages-repository';

type ConversationsCliRequest = Extract<
  CliFactsRequest,
  Readonly<{ command: 'CONVERSATIONS_GET' | 'CONVERSATIONS_LIST' }>
>;

export type RunConversationsInput = Readonly<{
  database?: DatabaseOpenInput;
  openReadOnly?: typeof openReadOnly;
  request: ConversationsCliRequest;
}>;

function closeQuietly(handle: Awaited<ReturnType<typeof openReadOnly>> | null): void {
  try {
    handle?.close();
  } catch (_error) {
    // The one-shot command has no reusable handle after its result is determined.
  }
}

/** Executes exactly one read-only list or detail query and closes its SQLite handle before returning. */
export async function runConversations(input: RunConversationsInput): Promise<unknown> {
  const { request } = input;
  const list =
    request.command === 'CONVERSATIONS_LIST'
      ? (() => {
          const scope = createSqliteConversationListScope({
            ...(request.payload.sourceKey ? { sourceKey: request.payload.sourceKey } : null),
            ...(request.payload.siteKey ? { siteKey: request.payload.siteKey } : null),
          });
          return Object.freeze({
            cursor: request.payload.cursor ? decodeSqliteConversationListCursor(request.payload.cursor, scope) : null,
            scope,
          });
        })()
      : null;
  let handle: Awaited<ReturnType<typeof openReadOnly>> | null = null;
  try {
    handle = await (input.openReadOnly ?? openReadOnly)(input.database);
    const conversations = createConversationsRepository(handle.database);
    if (request.command === 'CONVERSATIONS_GET') {
      const conversation = conversations.getConversationById(request.payload.id);
      if (!conversation) return null;
      return Object.freeze({
        conversation,
        messages: createMessagesRepository(handle.database).getConversationDetail(request.payload.id).messages,
      });
    }
    const query = { sourceKey: list!.scope.sourceKey, siteKey: list!.scope.siteKey };
    const page = list!.cursor
      ? conversations.getConversationListPage(query, list!.cursor, request.payload.limit)
      : conversations.getConversationListBootstrap(query, request.payload.limit);
    return Object.freeze({
      ...page,
      cursor: page.cursor ? encodeSqliteConversationListCursor(page.cursor, list!.scope) : null,
    });
  } finally {
    closeQuietly(handle);
  }
}
