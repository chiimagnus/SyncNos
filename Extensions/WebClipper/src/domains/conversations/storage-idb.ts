import type { Conversation, ConversationMessage } from './models';
import { openDb as openSchemaDb } from '../../platform/idb/schema';

let cachedDb: IDBDatabase | null = null;
let openingDb: Promise<IDBDatabase> | null = null;

async function openDb(): Promise<IDBDatabase> {
  if (cachedDb) return cachedDb;
  if (openingDb) return openingDb;
  openingDb = openSchemaDb()
    .then((db) => {
      cachedDb = db;
      return db;
    })
    .finally(() => {
      openingDb = null;
    });
  return openingDb;
}

export async function __closeDbForTests(): Promise<void> {
  try {
    const db = cachedDb || (openingDb ? await openingDb : null);
    db?.close?.();
  } catch (_e) {
    // ignore
  } finally {
    cachedDb = null;
    openingDb = null;
  }
}

function tx(
  db: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
): { t: IDBTransaction; stores: Record<string, IDBObjectStore> } {
  const t = db.transaction(storeNames, mode);
  const stores: Record<string, IDBObjectStore> = {};
  for (const name of storeNames) stores[name] = t.objectStore(name);
  return { t, stores };
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('indexedDB request failed'));
  });
}

function txDone(t: IDBTransaction): Promise<true> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error || new Error('transaction failed'));
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

function withOptionalId<T extends Record<string, any>>(
  existingId: unknown,
  payload: T,
): T & { id?: number } {
  const id = Number(existingId);
  if (Number.isFinite(id) && id > 0) return { id, ...payload };
  return { ...payload };
}

export async function upsertConversation(payload: any): Promise<Conversation> {
  const db = await openDb();
  const { t, stores } = tx(db, ['conversations'], 'readwrite');
  const idx = stores.conversations.index('by_source_conversationKey');
  const existing: any = await reqToPromise(idx.get([payload.source, payload.conversationKey]) as any);

  const now = Date.now();
  const nextTitle =
    payload.title && String(payload.title).trim() ? String(payload.title).trim() : '';
  const nextUrl =
    payload.url && String(payload.url).trim() ? String(payload.url).trim() : '';

  const baseRecord = {
    sourceType: payload.sourceType || 'chat',
    source: payload.source,
    conversationKey: payload.conversationKey,
    title: nextTitle || (existing ? existing.title || '' : ''),
    url: nextUrl || (existing ? existing.url || '' : ''),
    author: payload.author || (existing ? existing.author || '' : ''),
    publishedAt: payload.publishedAt || (existing ? existing.publishedAt || '' : ''),
    description: payload.description || (existing ? existing.description || '' : ''),
    warningFlags: Array.isArray(payload.warningFlags) ? payload.warningFlags : [],
    notionPageId: payload.notionPageId || (existing ? existing.notionPageId || '' : ''),
    lastCapturedAt: payload.lastCapturedAt || now,
  };

  const record: any = withOptionalId(existing && existing.id, baseRecord);

  if (existing) {
    await reqToPromise(stores.conversations.put(record));
    await txDone(t);
    return record;
  }

  const id = await reqToPromise(stores.conversations.add(record));
  record.id = id as any;
  await txDone(t);
  return record;
}

export async function syncConversationMessages(
  conversationId: number,
  messages: any[],
): Promise<{ upserted: number; deleted: number }> {
  const db = await openDb();
  const { t, stores } = tx(db, ['messages'], 'readwrite');
  const idx = stores.messages.index('by_conversationId_messageKey');

  const presentKeys = new Set<string>();
  let upserted = 0;

  for (const m of messages || []) {
    if (!m || !m.messageKey) continue;
    presentKeys.add(String(m.messageKey));
    // eslint-disable-next-line no-await-in-loop
    const existing: any = await reqToPromise(idx.get([conversationId, m.messageKey]) as any);
    const incomingMarkdown =
      m.contentMarkdown && String(m.contentMarkdown).trim()
        ? String(m.contentMarkdown)
        : '';
    const baseRecord = {
      conversationId,
      messageKey: m.messageKey,
      role: m.role || 'assistant',
      contentText: m.contentText || '',
      contentMarkdown: incomingMarkdown || (existing ? existing.contentMarkdown || '' : ''),
      sequence: Number.isFinite(m.sequence) ? m.sequence : 0,
      updatedAt: m.updatedAt || Date.now(),
    };
    const record: any = withOptionalId(existing && existing.id, baseRecord);
    if (existing) {
      // eslint-disable-next-line no-await-in-loop
      await reqToPromise(stores.messages.put(record));
    } else {
      // eslint-disable-next-line no-await-in-loop
      const id = await reqToPromise(stores.messages.add(record));
      record.id = id as any;
    }
    upserted += 1;
  }

  // Cleanup: delete messages not present in snapshot.
  let deleted = 0;
  const seqIdx = stores.messages.index('by_conversationId_sequence');
  const range = IDBKeyRange.bound(
    [conversationId, -Infinity] as any,
    [conversationId, Infinity] as any,
  );
  const cursorReq = seqIdx.openCursor(range);
  await new Promise<void>((resolve, reject) => {
    cursorReq.onerror = () =>
      reject(cursorReq.error || new Error('cursor failed'));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return resolve();
      const v: any = cursor.value;
      if (v && v.messageKey && !presentKeys.has(String(v.messageKey))) {
        cursor.delete();
        deleted += 1;
      }
      cursor.continue();
    };
  });

  await txDone(t);
  return { upserted, deleted };
}

export async function getConversations(): Promise<Conversation[]> {
  const db = await openDb();
  const { t, stores } = tx(db, ['conversations'], 'readonly');
  const items = (await reqToPromise(stores.conversations.getAll())) as any[];
  await txDone(t);
  items.sort((a, b) => (b.lastCapturedAt || 0) - (a.lastCapturedAt || 0));
  return items as any;
}

export async function getMessagesByConversationId(
  conversationId: number,
): Promise<ConversationMessage[]> {
  const db = await openDb();
  const { t, stores } = tx(db, ['messages'], 'readonly');
  const idx = stores.messages.index('by_conversationId_sequence');
  const items = (await reqToPromise(
    idx.getAll(
      IDBKeyRange.bound(
        [conversationId, -Infinity] as any,
        [conversationId, Infinity] as any,
      ),
    ) as any,
  )) as any[];
  await txDone(t);
  items.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  return items as any;
}

export async function deleteConversationsByIds(
  conversationIds: any[],
): Promise<{ deletedConversations: number; deletedMessages: number; deletedMappings: number }> {
  const ids = Array.isArray(conversationIds)
    ? conversationIds
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    : [];
  if (!ids.length) {
    return { deletedConversations: 0, deletedMessages: 0, deletedMappings: 0 };
  }

  const db = await openDb();
  const { t, stores } = tx(db, ['conversations', 'messages', 'sync_mappings'], 'readwrite');

  let deletedConversations = 0;
  let deletedMessages = 0;
  let deletedMappings = 0;

  const msgIdx = stores.messages.index('by_conversationId_sequence');
  const mappingIdx = stores.sync_mappings.index('by_source_conversationKey');

  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const convo: any = await reqToPromise(stores.conversations.get(id));
    if (!convo) continue;

    // Delete messages under this conversation.
    const range = IDBKeyRange.bound(
      [id, -Infinity] as any,
      [id, Infinity] as any,
    );
    const cursorReq = msgIdx.openCursor(range);
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve, reject) => {
      cursorReq.onerror = () =>
        reject(cursorReq.error || new Error('cursor failed'));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        cursor.delete();
        deletedMessages += 1;
        cursor.continue();
      };
    });

    // Delete notion mapping if present.
    const source = convo.source || '';
    const conversationKey = convo.conversationKey || '';
    if (source && conversationKey) {
      // eslint-disable-next-line no-await-in-loop
      const mapping: any = await reqToPromise(mappingIdx.get([source, conversationKey]) as any);
      if (mapping && mapping.id) {
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(stores.sync_mappings.delete(mapping.id));
        deletedMappings += 1;
      }
    }

    await reqToPromise(stores.conversations.delete(id));
    deletedConversations += 1;
  }

  await txDone(t);
  return { deletedConversations, deletedMessages, deletedMappings };
}
