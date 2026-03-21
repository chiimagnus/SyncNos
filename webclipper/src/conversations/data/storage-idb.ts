import type { Conversation, ConversationMessage } from '../domain/models';
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

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeArticleUrl(raw: unknown): string {
  const text = safeString(raw);
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = safeString(url.protocol).toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

function isArticlePayload(payload: any): boolean {
  return safeString(payload?.sourceType).toLowerCase() === 'article';
}

function pickPreferredArticleConversation(candidates: any[]): any | null {
  const list = Array.isArray(candidates) ? candidates.slice() : [];
  if (!list.length) return null;
  list.sort((a, b) => {
    const aCanonical = safeString(a?.source) === 'web' && safeString(a?.conversationKey).startsWith('article:') ? 1 : 0;
    const bCanonical = safeString(b?.source) === 'web' && safeString(b?.conversationKey).startsWith('article:') ? 1 : 0;
    if (bCanonical !== aCanonical) return bCanonical - aCanonical;

    const aMapped = safeString(a?.notionPageId) ? 1 : 0;
    const bMapped = safeString(b?.notionPageId) ? 1 : 0;
    if (bMapped !== aMapped) return bMapped - aMapped;

    const at = Number(a?.lastCapturedAt) || 0;
    const bt = Number(b?.lastCapturedAt) || 0;
    if (bt !== at) return bt - at;

    const aid = Number(a?.id) || 0;
    const bid = Number(b?.id) || 0;
    return bid - aid;
  });
  return list[0] || null;
}

async function findExistingArticleConversationByUrl(
  conversationsStore: IDBObjectStore,
  rawUrl: unknown,
): Promise<any | null> {
  const normalizedUrl = normalizeArticleUrl(rawUrl);
  if (!normalizedUrl) return null;
  const rows = (await reqToPromise(conversationsStore.getAll() as any)) as any[];
  const matched = rows.filter((row) => {
    if (safeString(row?.sourceType).toLowerCase() !== 'article') return false;
    return normalizeArticleUrl(row?.url) === normalizedUrl;
  });
  return pickPreferredArticleConversation(matched);
}

async function findExistingConversationForPayload(
  conversationsStore: IDBObjectStore,
  payload: any,
): Promise<any | null> {
  const source = safeString(payload?.source);
  const conversationKey = safeString(payload?.conversationKey);
  if (!source || !conversationKey) return null;
  const idx = conversationsStore.index('by_source_conversationKey');
  let existing: any = await reqToPromise(idx.get([source, conversationKey]) as any);
  if (!existing && isArticlePayload(payload)) {
    existing = await findExistingArticleConversationByUrl(conversationsStore, payload?.url);
  }
  return existing || null;
}

export async function hasConversation(payload: any): Promise<boolean> {
  if (!payload) return false;
  const db = await openDb();
  const { t, stores } = tx(db, ['conversations'], 'readonly');
  const existing = await findExistingConversationForPayload(stores.conversations, payload);
  await txDone(t);
  return !!existing;
}

function pickMaxFiniteNumber(...values: unknown[]): number | null {
  let max: number | null = null;
  for (const value of values) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) continue;
    if (max == null || numberValue > max) max = numberValue;
  }
  return max;
}

function mergeSyncMappingRecord(base: any, incoming: any, fallbackNotionPageId: string): any {
  const current = base && typeof base === 'object' ? { ...base } : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const notionPageId =
    safeString(current.notionPageId) ||
    safeString(next.notionPageId) ||
    safeString(fallbackNotionPageId);
  const lastSyncedMessageKey =
    safeString(current.lastSyncedMessageKey) || safeString(next.lastSyncedMessageKey);
  const lastSyncedSequence = pickMaxFiniteNumber(current.lastSyncedSequence, next.lastSyncedSequence);
  const lastSyncedAt = pickMaxFiniteNumber(current.lastSyncedAt, next.lastSyncedAt);
  const lastSyncedMessageUpdatedAt = pickMaxFiniteNumber(
    current.lastSyncedMessageUpdatedAt,
    next.lastSyncedMessageUpdatedAt,
  );
  const updatedAt = pickMaxFiniteNumber(current.updatedAt, next.updatedAt, Date.now()) || Date.now();

  return {
    ...current,
    notionPageId,
    lastSyncedMessageKey,
    lastSyncedSequence,
    lastSyncedAt,
    lastSyncedMessageUpdatedAt,
    updatedAt,
  };
}

async function migrateSyncMappingKey(
  syncMappingsStore: IDBObjectStore,
  input: {
    legacySource: unknown;
    legacyConversationKey: unknown;
    nextSource: unknown;
    nextConversationKey: unknown;
    fallbackNotionPageId?: unknown;
  },
): Promise<void> {
  const legacySource = safeString(input.legacySource);
  const legacyConversationKey = safeString(input.legacyConversationKey);
  const nextSource = safeString(input.nextSource);
  const nextConversationKey = safeString(input.nextConversationKey);
  const fallbackNotionPageId = safeString(input.fallbackNotionPageId);

  if (!nextSource || !nextConversationKey) return;
  const idx = syncMappingsStore.index('by_source_conversationKey');

  const target = (await reqToPromise(idx.get([nextSource, nextConversationKey]) as any)) as any;
  if (legacySource === nextSource && legacyConversationKey === nextConversationKey) {
    if (!target) return;
    const merged = mergeSyncMappingRecord(target, null, fallbackNotionPageId);
    if (JSON.stringify(merged) !== JSON.stringify(target)) {
      await reqToPromise(syncMappingsStore.put(merged));
    }
    return;
  }

  if (!legacySource || !legacyConversationKey) {
    if (!target) return;
    const merged = mergeSyncMappingRecord(target, null, fallbackNotionPageId);
    if (JSON.stringify(merged) !== JSON.stringify(target)) {
      await reqToPromise(syncMappingsStore.put(merged));
    }
    return;
  }

  const legacy = (await reqToPromise(idx.get([legacySource, legacyConversationKey]) as any)) as any;
  if (!legacy) {
    if (!target) return;
    const merged = mergeSyncMappingRecord(target, null, fallbackNotionPageId);
    if (JSON.stringify(merged) !== JSON.stringify(target)) {
      await reqToPromise(syncMappingsStore.put(merged));
    }
    return;
  }

  if (!target) {
    legacy.source = nextSource;
    legacy.conversationKey = nextConversationKey;
    const merged = mergeSyncMappingRecord(legacy, null, fallbackNotionPageId);
    await reqToPromise(syncMappingsStore.put(merged));
    return;
  }

  const merged = mergeSyncMappingRecord(target, legacy, fallbackNotionPageId);
  await reqToPromise(syncMappingsStore.put(merged));

  const legacyId = Number(legacy.id);
  if (Number.isFinite(legacyId) && legacyId > 0 && legacyId !== Number(target.id)) {
    await reqToPromise(syncMappingsStore.delete(legacyId));
  }
}

export async function upsertConversation(payload: any): Promise<Conversation> {
  const db = await openDb();
  const { t, stores } = tx(db, ['conversations', 'sync_mappings'], 'readwrite');
  const existing = await findExistingConversationForPayload(stores.conversations, payload);

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
    warningFlags: Array.isArray(payload.warningFlags)
      ? payload.warningFlags
      : (existing ? existing.warningFlags || [] : []),
    notionPageId: payload.notionPageId || (existing ? existing.notionPageId || '' : ''),
    lastCapturedAt: payload.lastCapturedAt || now,
  };

  const record: any = withOptionalId(existing && existing.id, baseRecord);

  if (existing) {
    await migrateSyncMappingKey(stores.sync_mappings, {
      legacySource: existing.source,
      legacyConversationKey: existing.conversationKey,
      nextSource: record.source,
      nextConversationKey: record.conversationKey,
      fallbackNotionPageId: record.notionPageId,
    });
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
  options?: { mode?: 'snapshot' | 'incremental' | 'append'; diff?: { added?: string[]; updated?: string[]; removed?: string[] } | null },
): Promise<{ upserted: number; deleted: number }> {
  const db = await openDb();
  const { t, stores } = tx(db, ['messages'], 'readwrite');
  const idx = stores.messages.index('by_conversationId_messageKey');

  const mode = options?.mode === 'incremental' ? 'incremental' : options?.mode === 'append' ? 'append' : 'snapshot';
  const diff = options?.diff || null;

  const normalizeKeys = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.map((x) => String(x || '').trim()).filter(Boolean);
  };

  if (mode !== 'snapshot' && diff) {
    const byKey = new Map<string, any>();
    for (const m of messages || []) {
      const key = m && m.messageKey ? String(m.messageKey).trim() : '';
      if (!key) continue;
      byKey.set(key, m);
    }

    const upsertKeys = Array.from(
      new Set([...normalizeKeys(diff.added), ...normalizeKeys(diff.updated)]),
    );
    const allowDeletes = mode === 'incremental';
    const removedKeys = allowDeletes ? normalizeKeys(diff.removed) : [];

    let upserted = 0;
    for (const key of upsertKeys) {
      const m = byKey.get(key);
      if (!m) continue;
      // eslint-disable-next-line no-await-in-loop
      const existing: any = await reqToPromise(idx.get([conversationId, key]) as any);
      const incomingMarkdown =
        m.contentMarkdown && String(m.contentMarkdown).trim()
          ? String(m.contentMarkdown)
          : '';
      const baseRecord = {
        conversationId,
        messageKey: key,
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

    let deleted = 0;
    for (const key of removedKeys) {
      // eslint-disable-next-line no-await-in-loop
      const existing: any = await reqToPromise(idx.get([conversationId, key]) as any);
      const id = Number(existing && existing.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      // eslint-disable-next-line no-await-in-loop
      await reqToPromise(stores.messages.delete(id));
      deleted += 1;
    }

    await txDone(t);
    return { upserted, deleted };
  }

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

export async function syncConversationMessagesAppendOnly(
  conversationId: number,
  messages: any[],
  diff?: { added?: string[]; updated?: string[]; removed?: string[] } | null,
): Promise<{ upserted: number; deleted: number }> {
  return await syncConversationMessages(conversationId, messages, { mode: 'append', diff: diff || null });
}

export async function getConversations(): Promise<Conversation[]> {
  const db = await openDb();
  const { t, stores } = tx(db, ['conversations'], 'readonly');
  const items = (await reqToPromise(stores.conversations.getAll())) as any[];
  await txDone(t);
  items.sort((a, b) => (b.lastCapturedAt || 0) - (a.lastCapturedAt || 0));
  return items as any;
}

export async function getConversationBySourceConversationKey(
  source: string,
  conversationKey: string,
): Promise<Conversation | null> {
  const normalizedSource = safeString(source);
  const normalizedKey = safeString(conversationKey);
  if (!normalizedSource || !normalizedKey) return null;

  const db = await openDb();
  const { t, stores } = tx(db, ['conversations'], 'readonly');
  const idx = stores.conversations.index('by_source_conversationKey');
  const item = (await reqToPromise(idx.get([normalizedSource, normalizedKey]) as any)) as any;
  await txDone(t);
  return item || null;
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
): Promise<{ deletedConversations: number; deletedMessages: number; deletedMappings: number; deletedImageCache: number }> {
  const ids = Array.isArray(conversationIds)
    ? conversationIds
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    : [];
  if (!ids.length) {
    return { deletedConversations: 0, deletedMessages: 0, deletedMappings: 0, deletedImageCache: 0 };
  }

  const db = await openDb();
  const { t, stores } = tx(db, ['conversations', 'messages', 'sync_mappings', 'image_cache'], 'readwrite');

  let deletedConversations = 0;
  let deletedMessages = 0;
  let deletedMappings = 0;
  let deletedImageCache = 0;

  const msgIdx = stores.messages.index('by_conversationId_sequence');
  const mappingIdx = stores.sync_mappings.index('by_source_conversationKey');
  const imageCacheIdx = stores.image_cache.index('by_conversationId');

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

    // Delete cached images under this conversation.
    const imgRange = IDBKeyRange.only(id);
    const imgCursorReq = imageCacheIdx.openCursor(imgRange);
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve, reject) => {
      imgCursorReq.onerror = () =>
        reject(imgCursorReq.error || new Error('cursor failed'));
      imgCursorReq.onsuccess = () => {
        const cursor = imgCursorReq.result;
        if (!cursor) return resolve();
        cursor.delete();
        deletedImageCache += 1;
        cursor.continue();
      };
    });
  }

  await txDone(t);
  return { deletedConversations, deletedMessages, deletedMappings, deletedImageCache };
}

export async function getConversationById(conversationId: number): Promise<Conversation | null> {
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const db = await openDb();
  const { t, stores } = tx(db, ['conversations'], 'readonly');
  const row = (await reqToPromise(stores.conversations.get(id as any))) as any;
  await txDone(t);
  return (row || null) as Conversation | null;
}

export async function getSyncMappingByConversation(
  conversationId: number,
): Promise<{ conversation: Conversation; mapping: any | null } | null> {
  const conversation = await getConversationById(conversationId);
  if (!conversation) return null;

  const source = String((conversation as any).source || '').trim();
  const conversationKey = String((conversation as any).conversationKey || '').trim();
  if (!source || !conversationKey) {
    return { conversation, mapping: null };
  }

  const db = await openDb();
  const { t, stores } = tx(db, ['sync_mappings'], 'readonly');
  const idx = stores.sync_mappings.index('by_source_conversationKey');
  const mapping = (await reqToPromise(idx.get([source, conversationKey]) as any)) as any;
  await txDone(t);
  return { conversation, mapping: mapping || null };
}

export async function patchSyncMapping(
  conversationId: number,
  patch: Record<string, unknown>,
): Promise<true> {
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('invalid conversationId');
  if (!patch || typeof patch !== 'object') throw new Error('invalid patch');

  const db = await openDb();
  const { t, stores } = tx(db, ['conversations', 'sync_mappings'], 'readwrite');
  const conversation = (await reqToPromise(stores.conversations.get(id as any))) as any;
  if (!conversation) throw new Error('conversation not found');

  const source = String(conversation.source || '').trim();
  const conversationKey = String(conversation.conversationKey || '').trim();
  if (!source || !conversationKey) throw new Error('missing source or conversationKey');

  const idx = stores.sync_mappings.index('by_source_conversationKey');
  const existing = (await reqToPromise(idx.get([source, conversationKey]) as any)) as any;
  const now = Date.now();
  const patchObj: any = { ...patch };
  const incomingSections =
    patchObj.notionSections && typeof patchObj.notionSections === 'object' ? patchObj.notionSections : null;
  if (incomingSections) delete patchObj.notionSections;
  const existingSections =
    existing && typeof existing === 'object' && existing.notionSections && typeof existing.notionSections === 'object'
      ? existing.notionSections
      : null;
  const mergedSections = incomingSections
    ? {
        ...(existingSections || {}),
        ...Object.fromEntries(
          Object.entries(incomingSections).map(([key, value]) => [
            key,
            {
              ...((existingSections && (existingSections as any)[key] && typeof (existingSections as any)[key] === 'object'
                ? (existingSections as any)[key]
                : null) || {}),
              ...((value && typeof value === 'object' ? value : null) || {}),
            },
          ]),
        ),
      }
    : null;
  const next = {
    ...(existing && typeof existing === 'object' ? existing : null),
    ...patchObj,
    source,
    conversationKey,
    notionPageId: String((patch as any)?.notionPageId || existing?.notionPageId || conversation.notionPageId || ''),
    ...(mergedSections ? { notionSections: mergedSections } : null),
    updatedAt: now,
  } as any;
  const payload: any = withOptionalId(existing && existing.id, next);
  if (existing) await reqToPromise(stores.sync_mappings.put(payload));
  else await reqToPromise(stores.sync_mappings.add(payload));

  await txDone(t);
  return true;
}

export async function setConversationNotionPageId(
  conversationId: number,
  notionPageId: string,
): Promise<true> {
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('invalid conversationId');

  const db = await openDb();
  const { t, stores } = tx(db, ['conversations', 'sync_mappings'], 'readwrite');
  const conversation = (await reqToPromise(stores.conversations.get(id as any))) as any;
  if (!conversation) throw new Error('conversation not found');

  conversation.notionPageId = notionPageId || '';
  await reqToPromise(stores.conversations.put(conversation));

  const source = String(conversation.source || '').trim();
  const conversationKey = String(conversation.conversationKey || '').trim();
  if (source && conversationKey) {
    const idx = stores.sync_mappings.index('by_source_conversationKey');
    const existing = (await reqToPromise(idx.get([source, conversationKey]) as any)) as any;
    const preserved: any = existing && typeof existing === 'object' ? { ...existing } : {};
    if (preserved && typeof preserved === 'object') delete preserved.id;
    const payload: any = withOptionalId(existing && existing.id, {
      ...preserved,
      source,
      conversationKey,
      notionPageId: notionPageId || '',
      updatedAt: Date.now(),
    });
    if (existing) await reqToPromise(stores.sync_mappings.put(payload));
    else await reqToPromise(stores.sync_mappings.add(payload));
  }

  await txDone(t);
  return true;
}

export async function setSyncCursor(
  conversationId: number,
  input: {
    lastSyncedMessageKey?: string;
    lastSyncedSequence?: number | null;
    lastSyncedAt?: number | null;
    lastSyncedMessageUpdatedAt?: number | null;
    notionCommentsDigest?: string;
    notionArticleDigest?: string;
    notionWebArticleLayoutVersion?: number | null;
    notionSectionCursors?: Record<string, unknown>;
    notionSectionDigests?: Record<string, unknown>;
    notionSections?: Record<string, unknown>;
  },
): Promise<true> {
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('invalid conversationId');

  const db = await openDb();
  const { t, stores } = tx(db, ['conversations', 'sync_mappings'], 'readwrite');
  const conversation = (await reqToPromise(stores.conversations.get(id as any))) as any;
  if (!conversation) throw new Error('conversation not found');

  const source = String(conversation.source || '').trim();
  const conversationKey = String(conversation.conversationKey || '').trim();
  if (!source || !conversationKey) throw new Error('missing source or conversationKey');

  const idx = stores.sync_mappings.index('by_source_conversationKey');
  const existing = (await reqToPromise(idx.get([source, conversationKey]) as any)) as any;
  const now = Date.now();
  const preserved: any = existing && typeof existing === 'object' ? { ...existing } : {};
  if (preserved && typeof preserved === 'object') delete preserved.id;
  const mergeNestedRecord = (prev: any, incoming: any): any | null => {
    if (!incoming || typeof incoming !== 'object') return null;
    const base = prev && typeof prev === 'object' ? prev : {};
    const out: any = { ...base };
    for (const [key, value] of Object.entries(incoming)) {
      const k = String(key || '').trim();
      if (!k) continue;
      out[k] = {
        ...((base as any)[k] && typeof (base as any)[k] === 'object' ? (base as any)[k] : {}),
        ...(value && typeof value === 'object' ? value : {}),
      };
    }
    return out;
  };
  const mergedNotionSections = mergeNestedRecord(preserved.notionSections, input?.notionSections);
  const mergedNotionSectionCursors = mergeNestedRecord(preserved.notionSectionCursors, input?.notionSectionCursors);
  const mergedNotionSectionDigests = mergeNestedRecord(preserved.notionSectionDigests, input?.notionSectionDigests);
  const payload: any = withOptionalId(existing && existing.id, {
    ...preserved,
    source,
    conversationKey,
    notionPageId: String(existing?.notionPageId || conversation.notionPageId || ''),
    lastSyncedMessageKey: String(input?.lastSyncedMessageKey || ''),
    lastSyncedSequence: Number.isFinite(Number(input?.lastSyncedSequence))
      ? Number(input?.lastSyncedSequence)
      : null,
    lastSyncedAt: Number.isFinite(Number(input?.lastSyncedAt))
      ? Number(input?.lastSyncedAt)
      : now,
    lastSyncedMessageUpdatedAt: Number.isFinite(Number(input?.lastSyncedMessageUpdatedAt))
      ? Number(input?.lastSyncedMessageUpdatedAt)
      : null,
    notionCommentsDigest:
      input?.notionCommentsDigest != null
        ? String(input.notionCommentsDigest || '')
        : String(existing?.notionCommentsDigest || ''),
    notionArticleDigest:
      input?.notionArticleDigest != null
        ? String(input.notionArticleDigest || '')
        : String(existing?.notionArticleDigest || ''),
    notionWebArticleLayoutVersion: Number.isFinite(Number(input?.notionWebArticleLayoutVersion))
      ? Number(input?.notionWebArticleLayoutVersion)
      : Number.isFinite(Number(existing?.notionWebArticleLayoutVersion))
        ? Number(existing?.notionWebArticleLayoutVersion)
        : null,
    ...(mergedNotionSections ? { notionSections: mergedNotionSections } : null),
    ...(mergedNotionSectionCursors ? { notionSectionCursors: mergedNotionSectionCursors } : null),
    ...(mergedNotionSectionDigests ? { notionSectionDigests: mergedNotionSectionDigests } : null),
    updatedAt: now,
  });
  if (existing) await reqToPromise(stores.sync_mappings.put(payload));
  else await reqToPromise(stores.sync_mappings.add(payload));

  await txDone(t);
  return true;
}

export async function clearSyncCursor(conversationId: number): Promise<true> {
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('invalid conversationId');

  const db = await openDb();
  const { t, stores } = tx(db, ['conversations', 'sync_mappings'], 'readwrite');
  const conversation = (await reqToPromise(stores.conversations.get(id as any))) as any;
  if (!conversation) throw new Error('conversation not found');

  const source = String(conversation.source || '').trim();
  const conversationKey = String(conversation.conversationKey || '').trim();
  if (!source || !conversationKey) throw new Error('missing source or conversationKey');

  const idx = stores.sync_mappings.index('by_source_conversationKey');
  const existing = (await reqToPromise(idx.get([source, conversationKey]) as any)) as any;
  if (existing && existing.id) {
    existing.lastSyncedMessageKey = '';
    existing.lastSyncedSequence = null;
    existing.lastSyncedAt = null;
    existing.lastSyncedMessageUpdatedAt = null;
    existing.updatedAt = Date.now();
    await reqToPromise(stores.sync_mappings.put(existing));
  }

  await txDone(t);
  return true;
}
