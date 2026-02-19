/* global indexedDB, IDBKeyRange */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const DB_NAME = "webclipper";
  const DB_VERSION = 2;

  function extractNotionAiThreadIdFromUrl(url) {
    try {
      const u = new URL(String(url || ""));
      const t = String(u.searchParams.get("t") || "").trim();
      if (/^[0-9a-fA-F]{32}$/.test(t)) return t.toLowerCase();
      const hash = String(u.hash || "").replace(/^#/, "");
      const m = hash.match(/(?:^|[?&])t=([0-9a-fA-F]{32})(?:[&#]|$)/);
      return m ? String(m[1]).toLowerCase() : "";
    } catch (_e) {
      return "";
    }
  }

  function notionAiStableConversationKey(threadId) {
    return threadId ? `notionai_t_${threadId}` : "";
  }

  function notionAiCanonicalChatUrl(threadId) {
    return threadId ? `https://www.notion.so/chat?t=${threadId}&wfv=chat` : "";
  }

  function migrateNotionAiThreadConversations({ db, tx }) {
    if (!db || !tx) return;
    if (!db.objectStoreNames.contains("conversations")) return;
    if (!db.objectStoreNames.contains("messages")) return;
    if (!db.objectStoreNames.contains("sync_mappings")) return;

    const conversationsStore = tx.objectStore("conversations");
    const messagesStore = tx.objectStore("messages");
    const mappingsStore = tx.objectStore("sync_mappings");

    let msgSeqIdx = null;
    let msgKeyIdx = null;
    let mappingIdx = null;
    let convoKeyIdx = null;
    try {
      msgSeqIdx = messagesStore.index("by_conversationId_sequence");
      msgKeyIdx = messagesStore.index("by_conversationId_messageKey");
      mappingIdx = mappingsStore.index("by_source_conversationKey");
      convoKeyIdx = conversationsStore.index("by_source_conversationKey");
    } catch (_e) {
      // ignore
    }
    if (!msgSeqIdx || !msgKeyIdx || !mappingIdx || !convoKeyIdx) return;

    function migrateMappingKey({ legacyKey, stableKey, onDone }) {
      if (!legacyKey || legacyKey === stableKey) {
        onDone && onDone({ ok: true, changed: false });
        return;
      }
      const mapReq = mappingIdx.get(["notionai", legacyKey]);
      mapReq.onsuccess = () => {
        const mapping = mapReq.result;
        if (!mapping) {
          onDone && onDone({ ok: true, changed: false });
          return;
        }
        const targetReq = mappingIdx.get(["notionai", stableKey]);
        targetReq.onsuccess = () => {
          const target = targetReq.result;
          if (!target) {
            mapping.conversationKey = stableKey;
            mapping.updatedAt = Date.now();
            mappingsStore.put(mapping);
          } else {
            mappingsStore.delete(mapping.id);
          }
          onDone && onDone({ ok: true, changed: true });
        };
        targetReq.onerror = () => onDone && onDone({ ok: false, changed: false });
      };
      mapReq.onerror = () => onDone && onDone({ ok: false, changed: false });
    }

    function migrateMessagesFromDupToKeep({ dupId, keepId, onDone }) {
      let hadAny = false;
      let ok = true;

      function done() {
        onDone && onDone({ ok, hadAny });
      }

      function tryFallbackCursor() {
        try {
          const cursorReq = messagesStore.openCursor();
          cursorReq.onsuccess = () => {
            const cur = cursorReq.result;
            if (!cur) return done();
            const msg = cur.value;
            if (!msg || Number(msg.conversationId) !== dupId) {
              cur.continue();
              return;
            }
            hadAny = true;
            const messageKey = msg && msg.messageKey ? String(msg.messageKey) : "";
            if (!messageKey) {
              cur.delete();
              cur.continue();
              return;
            }
            const existsReq = msgKeyIdx.get([keepId, messageKey]);
            existsReq.onsuccess = () => {
              const existing = existsReq.result;
              if (existing) {
                cur.delete();
              } else {
                msg.conversationId = keepId;
                cur.update(msg);
              }
              cur.continue();
            };
            existsReq.onerror = () => {
              ok = false;
              done();
            };
          };
          cursorReq.onerror = () => {
            ok = false;
            done();
          };
        } catch (_e) {
          ok = false;
          done();
        }
      }

      try {
        const range = (typeof IDBKeyRange !== "undefined" && IDBKeyRange && IDBKeyRange.bound)
          ? IDBKeyRange.bound([dupId, -Infinity], [dupId, Infinity])
          : null;
        if (!range) {
          tryFallbackCursor();
          return;
        }

        const msgCursorReq = msgSeqIdx.openCursor(range);
        msgCursorReq.onsuccess = () => {
          const cur = msgCursorReq.result;
          if (!cur) return done();
          hadAny = true;
          const msg = cur.value;
          const messageKey = msg && msg.messageKey ? String(msg.messageKey) : "";
          if (!messageKey) {
            cur.delete();
            cur.continue();
            return;
          }
          const existsReq = msgKeyIdx.get([keepId, messageKey]);
          existsReq.onsuccess = () => {
            const existing = existsReq.result;
            if (existing) {
              cur.delete();
            } else {
              msg.conversationId = keepId;
              cur.update(msg);
            }
            cur.continue();
          };
          existsReq.onerror = () => {
            ok = false;
            done();
          };
        };
        msgCursorReq.onerror = () => {
          // Fallback: scan the store if the index cursor fails for any reason.
          tryFallbackCursor();
        };
      } catch (_e) {
        tryFallbackCursor();
      }
    }

    const notionConvos = [];
    const cursorReq = conversationsStore.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const v = cursor.value;
        const source = v && v.source ? String(v.source) : "";
        if (source === "notionai") {
          const threadId = extractNotionAiThreadIdFromUrl(v && v.url ? v.url : "");
          if (threadId) {
            notionConvos.push({ ...v, __threadId: threadId });
          }
        }
        cursor.continue();
        return;
      }

      const groups = new Map();
      for (const c of notionConvos) {
        const tid = c.__threadId;
        const list = groups.get(tid) || [];
        list.push(c);
        groups.set(tid, list);
      }

      const threads = Array.from(groups.entries());
      let threadIdx = 0;

      const processNextThread = () => {
        if (threadIdx >= threads.length) return;
        const [threadId, convos] = threads[threadIdx];
        threadIdx += 1;

        const stableKey = notionAiStableConversationKey(threadId);
        const canonicalUrl = notionAiCanonicalChatUrl(threadId);

        // Preflight: if a stableKey record already exists (even if it wasn't grouped due to legacy URL),
        // always use it as the keep record to avoid unique index constraint errors.
        function proceedWithStableExisting(stableExisting) {
          const seenIds = new Set(convos.map((c) => Number(c && c.id)).filter((x) => Number.isFinite(x) && x > 0));
          const mergedConvos = stableExisting && stableExisting.id && !seenIds.has(Number(stableExisting.id))
            ? convos.concat([{ ...stableExisting, __threadId: threadId }])
            : convos;

          let keep = null;
          if (stableExisting && stableExisting.id) {
            keep = stableExisting;
          } else {
            for (const c of mergedConvos) {
              if (c && String(c.conversationKey || "") === stableKey) {
                keep = c;
                break;
              }
            }
          }
          if (!keep) {
            keep = mergedConvos.slice().sort((a, b) => {
              const at = Number(a && a.lastCapturedAt) || 0;
              const bt = Number(b && b.lastCapturedAt) || 0;
              if (bt !== at) return bt - at;
              const aid = Number(a && a.id) || 0;
              const bid = Number(b && b.id) || 0;
              return bid - aid;
            })[0] || null;
          }

          const keepId = keep && keep.id ? Number(keep.id) : 0;
          if (!Number.isFinite(keepId) || keepId <= 0) {
            processNextThread();
            return;
          }

          // 1) Ensure keep convo has stable key + canonical url, and migrate mapping if key changed.
          try {
            const keepReq = conversationsStore.get(keepId);
            keepReq.onsuccess = () => {
              const rec = keepReq.result;
              const legacyKeepKey = rec ? String(rec.conversationKey || "") : "";
              if (rec) {
                let changed = false;
                if (String(rec.conversationKey || "") !== stableKey) {
                  rec.conversationKey = stableKey;
                  changed = true;
                }
                if (canonicalUrl && String(rec.url || "") !== canonicalUrl) {
                  rec.url = canonicalUrl;
                  changed = true;
                }
                if (changed) conversationsStore.put(rec);
              }

              migrateMappingKey({
                legacyKey: legacyKeepKey,
                stableKey,
                onDone: () => {
                  // 2) Migrate dup convos into keep.
                  const dups = mergedConvos.filter((c) => c && Number(c.id) !== keepId);
                  let dupIdx = 0;

                  const processNextDup = () => {
                    if (dupIdx >= dups.length) {
                      processNextThread();
                      return;
                    }
                    const dup = dups[dupIdx];
                    dupIdx += 1;
                    const dupId = dup && dup.id ? Number(dup.id) : 0;
                    if (!Number.isFinite(dupId) || dupId <= 0) {
                      processNextDup();
                      return;
                    }

                    const legacyKey = String(dup.conversationKey || "");

                    migrateMessagesFromDupToKeep({
                      dupId,
                      keepId,
                      onDone: ({ ok }) => {
                        if (!ok) {
                          // Best-effort: keep data but ensure the dup record at least points to the canonical chat URL.
                          try {
                            const dupReq = conversationsStore.get(dupId);
                            dupReq.onsuccess = () => {
                              const dupRec = dupReq.result;
                              if (dupRec && canonicalUrl && String(dupRec.url || "") !== canonicalUrl) {
                                dupRec.url = canonicalUrl;
                                conversationsStore.put(dupRec);
                              }
                              processNextDup();
                            };
                            dupReq.onerror = () => processNextDup();
                          } catch (_e) {
                            processNextDup();
                          }
                          return;
                        }

                        migrateMappingKey({
                          legacyKey,
                          stableKey,
                          onDone: () => {
                            conversationsStore.delete(dupId);
                            processNextDup();
                          }
                        });
                      }
                    });
                  };

                  processNextDup();
                }
              });
            };
          } catch (_e) {
            processNextThread();
          }
        };
        const stableReq = convoKeyIdx.get(["notionai", stableKey]);
        stableReq.onsuccess = () => proceedWithStableExisting(stableReq.result || null);
        stableReq.onerror = () => proceedWithStableExisting(null);
      };

      processNextThread();
    };
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
      req.onupgradeneeded = (e) => {
        const db = req.result;
        const t = req.transaction;
        const oldVersion = (e && typeof e.oldVersion === "number") ? e.oldVersion : 0;

        // conversations: { id, sourceType, source, conversationKey, title, url, author, publishedAt, description, warningFlags, notionPageId, lastCapturedAt }
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

        // v2 migration: NotionAI stable key by thread id (`t` query param).
        try {
          if (t && oldVersion < 2) {
            migrateNotionAiThreadConversations({ db, tx: t });
          }
        } catch (_e) {
          // ignore
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

  const api = { DB_NAME, DB_VERSION, openDb };
  NS.storageSchema = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
