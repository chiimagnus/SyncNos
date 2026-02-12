/* global chrome */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  function ok(data) {
    return { ok: true, data, error: null };
  }

  function err(message, extra) {
    return { ok: false, data: null, error: { message, extra: extra || null } };
  }

  // IndexedDB schema is initialized lazily; this avoids MV3 SW cold-start races.
  const DB_NAME = "webclipper";
  const DB_VERSION = 1;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
      req.onupgradeneeded = () => {
        const db = req.result;

        // conversations: { id, sourceType, source, conversationKey, title, url, warningFlags, notionPageId, lastCapturedAt }
        if (!db.objectStoreNames.contains("conversations")) {
          const store = db.createObjectStore("conversations", { keyPath: "id", autoIncrement: true });
          store.createIndex("by_source_conversationKey", ["source", "conversationKey"], { unique: true });
          store.createIndex("by_lastCapturedAt", "lastCapturedAt", { unique: false });
        }

        // messages: { id, conversationId, messageKey, role, contentText, sequence, updatedAt }
        if (!db.objectStoreNames.contains("messages")) {
          const store = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
          store.createIndex("by_conversationId_sequence", ["conversationId", "sequence"], { unique: false });
          store.createIndex("by_conversationId_messageKey", ["conversationId", "messageKey"], { unique: true });
        }

        // sync_mappings: { id, source, conversationKey, notionPageId, updatedAt }
        if (!db.objectStoreNames.contains("sync_mappings")) {
          const store = db.createObjectStore("sync_mappings", { keyPath: "id", autoIncrement: true });
          store.createIndex("by_source_conversationKey", ["source", "conversationKey"], { unique: true });
          store.createIndex("by_notionPageId", "notionPageId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

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

  async function upsertConversation(payload) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations"], "readwrite");
    const idx = stores.conversations.index("by_source_conversationKey");
    const existing = await reqToPromise(idx.get([payload.source, payload.conversationKey]));

    const now = Date.now();
    const record = {
      id: existing ? existing.id : undefined,
      sourceType: payload.sourceType || "chat",
      source: payload.source,
      conversationKey: payload.conversationKey,
      title: payload.title || "",
      url: payload.url || "",
      warningFlags: Array.isArray(payload.warningFlags) ? payload.warningFlags : [],
      notionPageId: payload.notionPageId || (existing ? existing.notionPageId || "" : ""),
      lastCapturedAt: payload.lastCapturedAt || now
    };

    if (existing) {
      await reqToPromise(stores.conversations.put(record));
      await new Promise((r, rej) => {
        t.oncomplete = r;
        t.onerror = () => rej(t.error || new Error("transaction failed"));
      });
      return record;
    }

    const id = await reqToPromise(stores.conversations.add(record));
    record.id = id;
    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    return record;
  }

  async function upsertMessagesIncremental(conversationId, messages) {
    const db = await openDb();
    const { t, stores } = tx(db, ["messages"], "readwrite");
    const idx = stores.messages.index("by_conversationId_messageKey");

    let upserted = 0;
    for (const m of messages || []) {
      if (!m || !m.messageKey) continue;
      const existing = await reqToPromise(idx.get([conversationId, m.messageKey]));
      const record = {
        id: existing ? existing.id : undefined,
        conversationId,
        messageKey: m.messageKey,
        role: m.role || "assistant",
        contentText: m.contentText || "",
        sequence: Number.isFinite(m.sequence) ? m.sequence : 0,
        updatedAt: m.updatedAt || Date.now()
      };
      if (existing) {
        await reqToPromise(stores.messages.put(record));
      } else {
        const id = await reqToPromise(stores.messages.add(record));
        record.id = id;
      }
      upserted += 1;
    }

    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    return { upserted };
  }

  async function getConversations() {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations"], "readonly");
    const items = await reqToPromise(stores.conversations.getAll());
    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    items.sort((a, b) => (b.lastCapturedAt || 0) - (a.lastCapturedAt || 0));
    return items;
  }

  async function getMessagesByConversationId(conversationId) {
    const db = await openDb();
    const { t, stores } = tx(db, ["messages"], "readonly");
    const idx = stores.messages.index("by_conversationId_sequence");
    const items = await reqToPromise(idx.getAll(IDBKeyRange.bound([conversationId, -Infinity], [conversationId, Infinity])));
    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    items.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    return items;
  }

  async function deleteConversation(conversationId) {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations", "messages"], "readwrite");
    await reqToPromise(stores.conversations.delete(conversationId));

    // Delete messages for conversation by scanning index. OK for MVP scale.
    const idx = stores.messages.index("by_conversationId_sequence");
    const range = IDBKeyRange.bound([conversationId, -Infinity], [conversationId, Infinity]);
    const cursorReq = idx.openCursor(range);
    await new Promise((resolve, reject) => {
      cursorReq.onerror = () => reject(cursorReq.error || new Error("cursor failed"));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
    });

    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    return { deleted: true };
  }

  async function clearAll() {
    const db = await openDb();
    const { t, stores } = tx(db, ["conversations", "messages", "sync_mappings"], "readwrite");
    await Promise.all([
      reqToPromise(stores.conversations.clear()),
      reqToPromise(stores.messages.clear()),
      reqToPromise(stores.sync_mappings.clear())
    ]);
    await new Promise((r, rej) => {
      t.oncomplete = r;
      t.onerror = () => rej(t.error || new Error("transaction failed"));
    });
    return { cleared: true };
  }

  async function handleMessage(msg) {
    if (!msg || typeof msg.type !== "string") return err("invalid message");

    switch (msg.type) {
      case "upsertConversation": {
        const convo = await upsertConversation(msg.payload || {});
        return ok(convo);
      }
      case "upsertMessagesIncremental": {
        const res = await upsertMessagesIncremental(msg.conversationId, msg.messages);
        return ok(res);
      }
      case "getConversations": {
        const items = await getConversations();
        return ok(items);
      }
      case "getConversationDetail": {
        const messages = await getMessagesByConversationId(msg.conversationId);
        return ok({ conversationId: msg.conversationId, messages });
      }
      case "deleteConversation": {
        const res = await deleteConversation(msg.conversationId);
        return ok(res);
      }
      case "clearAll": {
        const res = await clearAll();
        return ok(res);
      }
      default:
        return err(`unknown message type: ${msg.type}`);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    Promise.resolve()
      .then(() => handleMessage(msg))
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse(err(e && e.message ? e.message : "unknown error", String(e))));
    return true;
  });

  NS.__backgroundReady = true;
})();

