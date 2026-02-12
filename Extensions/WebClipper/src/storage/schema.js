/* global indexedDB */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

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

  const api = { DB_NAME, DB_VERSION, openDb };
  NS.storageSchema = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

