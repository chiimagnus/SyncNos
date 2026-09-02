import { openDb } from '@platform/idb/schema';
import type { Conversation } from '@services/conversations/domain/models';

type MessageCountByConversation = Map<number, number>;
type CommentCountByConversation = Map<number, number>;

export type InsightStatsSourceData = {
  conversations: Conversation[];
  messageCounts: MessageCountByConversation;
  commentCounts: CommentCountByConversation;
};

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('transaction aborted'));
  });
}

async function readAllConversations(store: IDBObjectStore): Promise<Conversation[]> {
  return ((await reqToPromise(store.getAll())) as Conversation[]) || [];
}

async function readCountsByConversationId(index: IDBIndex): Promise<Map<number, number>> {
  const counts = new Map<number, number>();

  await new Promise<void>((resolve, reject) => {
    const request = index.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      const key = cursor.key;
      const conversationId = Array.isArray(key) ? Number(key[0]) : Number.NaN;
      if (Number.isFinite(conversationId) && conversationId > 0) {
        counts.set(conversationId, (counts.get(conversationId) || 0) + 1);
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });

  return counts;
}

export async function getInsightStatsSourceData(): Promise<InsightStatsSourceData> {
  const db = await openDb();
  const transaction = db.transaction(['conversations', 'messages', 'article_comments'], 'readonly');
  const done = txDone(transaction);
  const conversationsStore = transaction.objectStore('conversations');
  const messagesIndex = transaction.objectStore('messages').index('by_conversationId_sequence');
  const commentsIndex = transaction.objectStore('article_comments').index('by_conversationId_createdAt');

  const reads = Promise.all([
    readAllConversations(conversationsStore),
    readCountsByConversationId(messagesIndex),
    readCountsByConversationId(commentsIndex),
  ]);
  const [[conversations, messageCounts, commentCounts]] = await Promise.all([reads, done]);

  return { conversations, messageCounts, commentCounts };
}
