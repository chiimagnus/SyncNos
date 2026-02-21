/* global IDBKeyRange */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  // IndexedDB schema is initialized lazily; this avoids MV3 SW cold-start races.
  const openDb = (NS.storageSchema && NS.storageSchema.openDb) || (async () => Promise.reject(new Error("schema not loaded")));

  function tx(db, storeNames, mode) {
    const t = db.transaction(storeNames, mode);
    return { t, stores: storeNames.reduce((acc, n) => ((acc[n] = t.objectStore(n)), acc), {}) };
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("indexedDB request failed"));
    });
  }

  function txDone(t) {
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error || new Error("transaction failed"));
      t.onabort = () => reject(t.error || new Error("transaction aborted"));
    });
  }

  function withOptionalId(existingId, payload) {
    if (Number.isFinite(existingId) && existingId > 0) return { id: existingId, ...payload };
    return { ...payload };
  }

  async function upsertConversation(payload) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations"], "readwrite");
    const idx = stores.conversations.index("by_source_conversationKey");
    const existing = await reqToPromise(idx.get([payload.source, payload.conversationKey]));

    const now = Date.now();
    const nextTitle = (payload.title && String(payload.title).trim()) ? String(payload.title).trim() : "";
    const nextUrl = (payload.url && String(payload.url).trim()) ? String(payload.url).trim() : "";
    const baseRecord = {
      sourceType: payload.sourceType || "chat",
      source: payload.source,
      conversationKey: payload.conversationKey,
      title: nextTitle || (existing ? existing.title || "" : ""),
      url: nextUrl || (existing ? existing.url || "" : ""),
      // Optional metadata (mainly for `sourceType=article`, but safe for all sources).
      author: payload.author || (existing ? existing.author || "" : ""),
      publishedAt: payload.publishedAt || (existing ? existing.publishedAt || "" : ""),
      description: payload.description || (existing ? existing.description || "" : ""),
      warningFlags: Array.isArray(payload.warningFlags) ? payload.warningFlags : [],
      notionPageId: payload.notionPageId || (existing ? existing.notionPageId || "" : ""),
      lastCapturedAt: payload.lastCapturedAt || now
    };
    const record = withOptionalId(existing && existing.id, baseRecord);

    if (existing) {
      await reqToPromise(stores.conversations.put(record));
      await txDone(t);
      return record;
    }

    const id = await reqToPromise(stores.conversations.add(record));
    record.id = id;
    await txDone(t);
    return record;
  }

  async function syncConversationMessages(conversationId, messages) {
    const db = await openDb();
    const { t, stores } = tx(db, ["messages"], "readwrite");
    const idx = stores.messages.index("by_conversationId_messageKey");

    const presentKeys = new Set();
    let upserted = 0;

    for (const m of messages || []) {
      if (!m || !m.messageKey) continue;
      presentKeys.add(m.messageKey);
      // eslint-disable-next-line no-await-in-loop
      const existing = await reqToPromise(idx.get([conversationId, m.messageKey]));
      const incomingMarkdown = (m.contentMarkdown && String(m.contentMarkdown).trim()) ? String(m.contentMarkdown) : "";
      const baseRecord = {
        conversationId,
        messageKey: m.messageKey,
        role: m.role || "assistant",
        contentText: m.contentText || "",
        contentMarkdown: incomingMarkdown || (existing ? existing.contentMarkdown || "" : ""),
        sequence: Number.isFinite(m.sequence) ? m.sequence : 0,
        updatedAt: m.updatedAt || Date.now()
      };
      const record = withOptionalId(existing && existing.id, baseRecord);
      if (existing) {
        // eslint-disable-next-line no-await-in-loop
        await reqToPromise(stores.messages.put(record));
      } else {
        // eslint-disable-next-line no-await-in-loop
        const id = await reqToPromise(stores.messages.add(record));
        record.id = id;
      }
      upserted += 1;
    }

    // Cleanup: delete messages that are no longer present in the captured snapshot.
    let deleted = 0;
    const seqIdx = stores.messages.index("by_conversationId_sequence");
    const range = IDBKeyRange.bound([conversationId, -Infinity], [conversationId, Infinity]);
    const cursorReq = seqIdx.openCursor(range);
    await new Promise((resolve, reject) => {
      cursorReq.onerror = () => reject(cursorReq.error || new Error("cursor failed"));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        const v = cursor.value;
        if (v && v.messageKey && !presentKeys.has(v.messageKey)) {
          cursor.delete();
          deleted += 1;
        }
        cursor.continue();
      };
    });

    await txDone(t);
    return { upserted, deleted };
  }

  async function getConversations() {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations"], "readonly");
    const items = await reqToPromise(stores.conversations.getAll());
    await txDone(t);
    items.sort((a, b) => (b.lastCapturedAt || 0) - (a.lastCapturedAt || 0));
    return items;
  }

  async function getConversationById(conversationId) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations"], "readonly");
    const item = await reqToPromise(stores.conversations.get(conversationId));
    await txDone(t);
    return item || null;
  }

  async function getMessagesByConversationId(conversationId) {
    const db = await openDb();
    const { t, stores } = tx(db, ["messages"], "readonly");
    const idx = stores.messages.index("by_conversationId_sequence");
    const items = await reqToPromise(idx.getAll(IDBKeyRange.bound([conversationId, -Infinity], [conversationId, Infinity])));
    await txDone(t);
    items.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    return items;
  }

  async function deleteConversationsByIds(conversationIds) {
    const ids = Array.isArray(conversationIds)
      ? conversationIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
      : [];
    if (!ids.length) return { deletedConversations: 0, deletedMessages: 0, deletedMappings: 0 };

    const db = await openDb();
    const { t, stores } = tx(db, ["conversations", "messages", "sync_mappings"], "readwrite");

    let deletedConversations = 0;
    let deletedMessages = 0;
    let deletedMappings = 0;

    const msgIdx = stores.messages.index("by_conversationId_sequence");
    const mappingIdx = stores.sync_mappings.index("by_source_conversationKey");

    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const convo = await reqToPromise(stores.conversations.get(id));
      if (!convo) continue;

      // Delete all messages under this conversation.
      const range = IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
      const cursorReq = msgIdx.openCursor(range);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve, reject) => {
        cursorReq.onerror = () => reject(cursorReq.error || new Error("cursor failed"));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return resolve();
          cursor.delete();
          deletedMessages += 1;
          cursor.continue();
        };
      });

      // Delete notion mapping if present.
      const source = convo.source || "";
      const conversationKey = convo.conversationKey || "";
      if (source && conversationKey) {
        // eslint-disable-next-line no-await-in-loop
        const mapping = await reqToPromise(mappingIdx.get([source, conversationKey]));
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

  async function setConversationNotionPageId(conversationId, notionPageId) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations", "sync_mappings"], "readwrite");
    const convo = await reqToPromise(stores.conversations.get(conversationId));
    if (!convo) throw new Error("conversation not found");
    convo.notionPageId = notionPageId || "";
    await reqToPromise(stores.conversations.put(convo));

    const idx = stores.sync_mappings.index("by_source_conversationKey");
    const existing = await reqToPromise(idx.get([convo.source, convo.conversationKey]));
    const mapping = withOptionalId(existing && existing.id, {
      source: convo.source,
      conversationKey: convo.conversationKey,
      notionPageId: notionPageId || "",
      updatedAt: Date.now()
    });
    if (existing) await reqToPromise(stores.sync_mappings.put(mapping));
    else await reqToPromise(stores.sync_mappings.add(mapping));

    await txDone(t);
    return true;
  }

  async function getSyncMappingByConversation(conversationId) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations", "sync_mappings"], "readonly");
    const convo = await reqToPromise(stores.conversations.get(conversationId));
    if (!convo) {
      await txDone(t);
      return null;
    }
    const source = convo.source || "";
    const conversationKey = convo.conversationKey || "";
    if (!source || !conversationKey) {
      await txDone(t);
      return { conversation: convo, mapping: null };
    }
    const idx = stores.sync_mappings.index("by_source_conversationKey");
    const mapping = await reqToPromise(idx.get([source, conversationKey]));
    await txDone(t);
    return { conversation: convo, mapping: mapping || null };
  }

  async function setSyncCursor(conversationId, { lastSyncedMessageKey, lastSyncedSequence, lastSyncedAt }) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations", "sync_mappings"], "readwrite");
    const convo = await reqToPromise(stores.conversations.get(conversationId));
    if (!convo) throw new Error("conversation not found");

    const source = convo.source || "";
    const conversationKey = convo.conversationKey || "";
    if (!source || !conversationKey) throw new Error("missing source or conversationKey");

    const idx = stores.sync_mappings.index("by_source_conversationKey");
    const existing = await reqToPromise(idx.get([source, conversationKey]));
    const now = Date.now();

    const mapping = withOptionalId(existing && existing.id, {
      source,
      conversationKey,
      notionPageId: (existing && existing.notionPageId) ? String(existing.notionPageId || "") : (convo.notionPageId || ""),
      lastSyncedMessageKey: lastSyncedMessageKey ? String(lastSyncedMessageKey) : "",
      lastSyncedSequence: Number.isFinite(lastSyncedSequence) ? Number(lastSyncedSequence) : null,
      lastSyncedAt: Number.isFinite(lastSyncedAt) ? Number(lastSyncedAt) : now,
      updatedAt: now
    });

    if (existing) await reqToPromise(stores.sync_mappings.put(mapping));
    else await reqToPromise(stores.sync_mappings.add(mapping));

    await txDone(t);
    return true;
  }

  async function clearSyncCursor(conversationId) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations", "sync_mappings"], "readwrite");
    const convo = await reqToPromise(stores.conversations.get(conversationId));
    if (!convo) throw new Error("conversation not found");

    const source = convo.source || "";
    const conversationKey = convo.conversationKey || "";
    if (!source || !conversationKey) throw new Error("missing source or conversationKey");

    const idx = stores.sync_mappings.index("by_source_conversationKey");
    const existing = await reqToPromise(idx.get([source, conversationKey]));
    if (existing && existing.id) {
      existing.lastSyncedMessageKey = "";
      existing.lastSyncedSequence = null;
      existing.lastSyncedAt = null;
      existing.updatedAt = Date.now();
      await reqToPromise(stores.sync_mappings.put(existing));
    }

    await txDone(t);
    return true;
  }

  NS.backgroundStorage = {
    upsertConversation,
    syncConversationMessages,
    getConversations,
    getConversationById,
    getMessagesByConversationId,
    deleteConversationsByIds,
    setConversationNotionPageId,
    getSyncMappingByConversation,
    setSyncCursor,
    clearSyncCursor
  };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.backgroundStorage;
})();
