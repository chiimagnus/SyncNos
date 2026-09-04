import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { closeDbForTests } from '@platform/idb/schema';
import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { ITEM_MENTION_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';
import { __resetConversationStorageStateForTests, upsertConversation } from '@services/conversations/data/storage-idb';
import { registerItemMentionHandlers } from '@services/integrations/item-mention/background-handlers';

function reqToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

async function deleteDb(name: string) {
  const req = indexedDB.deleteDatabase(name);
  await reqToPromise(req as unknown as IDBRequest<unknown>);
}

beforeEach(async () => {
  __resetConversationStorageStateForTests();
  closeDbForTests();
  // @ts-expect-error test global
  globalThis.indexedDB = indexedDB;
  // @ts-expect-error test global
  globalThis.IDBKeyRange = IDBKeyRange;
  await deleteDb('webclipper');
});

afterEach(async () => {
  __resetConversationStorageStateForTests();
  closeDbForTests();
  await deleteDb('webclipper');
});

describe('item mention search pipeline', () => {
  it('lets an older exact-title match outrank 50+ newer weak matches inside the bounded pool', async () => {
    const base = Date.now();
    const seeded = await Promise.all(
      Array.from({ length: 60 }, (_, index) => {
        const exact = index === 55;
        return upsertConversation({
          sourceType: 'chat',
          source: exact ? 'chatgpt' : index < 55 ? 'openai-weak' : 'chatgpt',
          conversationKey: `mention-pipeline-${index}`,
          title: exact ? 'OpenAI' : `Recent weak ${index}`,
          url: `https://example.com/${index}`,
          lastCapturedAt: base - index,
        });
      }),
    );
    const exactId = Number(seeded[55]?.id);

    const router = createBackgroundRouter({
      fallback: (msg: any) => ({
        ok: false,
        data: null,
        error: { message: `unknown message type: ${msg?.type}`, extra: null },
      }),
    });
    registerItemMentionHandlers(router as any);

    const response = await router.__handleMessageForTests({
      type: ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES,
      query: 'openai',
      limit: 20,
    });

    expect(response.ok).toBe(true);
    expect(response.data?.candidates).toHaveLength(20);
    expect(response.data?.candidates?.[0]?.conversationId).toBe(exactId);
  });
});
