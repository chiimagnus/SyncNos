export const DB_NAME = 'webclipper';
export const DB_VERSION = 3;

type MigrationContext = {
  db: IDBDatabase;
  tx: IDBTransaction;
};

type MigrationDone = (result: { ok: boolean; changed?: boolean; hadAny?: boolean }) => void;

function extractNotionAiThreadIdFromUrl(url: unknown): string {
  try {
    const parsed = new URL(String(url || ''));
    const t = String(parsed.searchParams.get('t') || '').trim();
    if (/^[0-9a-fA-F]{32}$/.test(t)) return t.toLowerCase();

    const hash = String(parsed.hash || '').replace(/^#/, '');
    const matched = hash.match(/(?:^|[?&])t=([0-9a-fA-F]{32})(?:[&#]|$)/);
    return matched ? String(matched[1]).toLowerCase() : '';
  } catch (_e) {
    return '';
  }
}

function notionAiStableConversationKey(threadId: string): string {
  return threadId ? `notionai_t_${threadId}` : '';
}

function notionAiCanonicalChatUrl(threadId: string): string {
  return threadId ? `https://www.notion.so/chat?t=${threadId}&wfv=chat` : '';
}

function migrateNotionAiThreadConversations({ db, tx }: MigrationContext): void {
  if (!db.objectStoreNames.contains('conversations')) return;
  if (!db.objectStoreNames.contains('messages')) return;
  if (!db.objectStoreNames.contains('sync_mappings')) return;

  const conversationsStore = tx.objectStore('conversations');
  const messagesStore = tx.objectStore('messages');
  const mappingsStore = tx.objectStore('sync_mappings');

  let msgSeqIdx: IDBIndex | null = null;
  let msgKeyIdx: IDBIndex | null = null;
  let mappingIdx: IDBIndex | null = null;
  let convoKeyIdx: IDBIndex | null = null;

  try {
    msgSeqIdx = messagesStore.index('by_conversationId_sequence');
    msgKeyIdx = messagesStore.index('by_conversationId_messageKey');
    mappingIdx = mappingsStore.index('by_source_conversationKey');
    convoKeyIdx = conversationsStore.index('by_source_conversationKey');
  } catch (_e) {
    return;
  }
  if (!msgSeqIdx || !msgKeyIdx || !mappingIdx || !convoKeyIdx) return;

  function migrateMappingKey(input: {
    legacyKey: string;
    stableKey: string;
    onDone: MigrationDone;
  }): void {
    const { legacyKey, stableKey, onDone } = input;
    if (!legacyKey || legacyKey === stableKey) {
      onDone({ ok: true, changed: false });
      return;
    }

    const mapReq = mappingIdx.get(['notionai', legacyKey]);
    mapReq.onsuccess = () => {
      const mapping = mapReq.result as Record<string, unknown> | undefined;
      if (!mapping) {
        onDone({ ok: true, changed: false });
        return;
      }

      const targetReq = mappingIdx.get(['notionai', stableKey]);
      targetReq.onsuccess = () => {
        const target = targetReq.result;
        if (!target) {
          mapping.conversationKey = stableKey;
          mapping.updatedAt = Date.now();
          mappingsStore.put(mapping);
        } else {
          const mappingId = Number((mapping as { id?: unknown }).id);
          if (Number.isFinite(mappingId) && mappingId > 0) mappingsStore.delete(mappingId);
        }
        onDone({ ok: true, changed: true });
      };
      targetReq.onerror = () => onDone({ ok: false, changed: false });
    };
    mapReq.onerror = () => onDone({ ok: false, changed: false });
  }

  function migrateMessagesFromDupToKeep(input: {
    dupId: number;
    keepId: number;
    onDone: MigrationDone;
  }): void {
    const { dupId, keepId, onDone } = input;
    let hadAny = false;
    let ok = true;

    function done() {
      onDone({ ok, hadAny });
    }

    function tryFallbackCursor(): void {
      try {
        const cursorReq = messagesStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return done();

          const msg = cursor.value as Record<string, unknown> | undefined;
          if (!msg || Number(msg.conversationId) !== dupId) {
            cursor.continue();
            return;
          }
          hadAny = true;

          const messageKey = msg.messageKey ? String(msg.messageKey) : '';
          if (!messageKey) {
            cursor.delete();
            cursor.continue();
            return;
          }

          const existsReq = msgKeyIdx.get([keepId, messageKey]);
          existsReq.onsuccess = () => {
            const existing = existsReq.result;
            if (existing) {
              cursor.delete();
            } else {
              msg.conversationId = keepId;
              cursor.update(msg);
            }
            cursor.continue();
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
      const keyRangeApi = globalThis.IDBKeyRange;
      const range = keyRangeApi?.bound
        ? keyRangeApi.bound([dupId, -Infinity], [dupId, Infinity])
        : null;
      if (!range) {
        tryFallbackCursor();
        return;
      }

      const msgCursorReq = msgSeqIdx.openCursor(range);
      msgCursorReq.onsuccess = () => {
        const cursor = msgCursorReq.result;
        if (!cursor) return done();
        hadAny = true;

        const msg = cursor.value as Record<string, unknown> | undefined;
        const messageKey = msg?.messageKey ? String(msg.messageKey) : '';
        if (!messageKey || !msg) {
          cursor.delete();
          cursor.continue();
          return;
        }

        const existsReq = msgKeyIdx.get([keepId, messageKey]);
        existsReq.onsuccess = () => {
          const existing = existsReq.result;
          if (existing) {
            cursor.delete();
          } else {
            msg.conversationId = keepId;
            cursor.update(msg);
          }
          cursor.continue();
        };
        existsReq.onerror = () => {
          ok = false;
          done();
        };
      };
      msgCursorReq.onerror = () => {
        tryFallbackCursor();
      };
    } catch (_e) {
      tryFallbackCursor();
    }
  }

  const notionConversations: Array<Record<string, unknown> & { __threadId?: string }> = [];
  const cursorReq = conversationsStore.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (cursor) {
      const row = cursor.value as Record<string, unknown> | undefined;
      const source = row?.source ? String(row.source) : '';
      if (source === 'notionai') {
        const threadId = extractNotionAiThreadIdFromUrl(row?.url);
        if (threadId) notionConversations.push({ ...(row || {}), __threadId: threadId });
      }
      cursor.continue();
      return;
    }

    const groups = new Map<string, Array<Record<string, unknown> & { __threadId?: string }>>();
    for (const conversation of notionConversations) {
      const threadId = String(conversation.__threadId || '');
      if (!threadId) continue;
      const list = groups.get(threadId) || [];
      list.push(conversation);
      groups.set(threadId, list);
    }

    const threads = Array.from(groups.entries());
    let threadIndex = 0;

    const processNextThread = () => {
      if (threadIndex >= threads.length) return;
      const [threadId, groupedConversations] = threads[threadIndex];
      threadIndex += 1;

      const stableKey = notionAiStableConversationKey(threadId);
      const canonicalUrl = notionAiCanonicalChatUrl(threadId);

      const proceedWithStableExisting = (stableExisting: Record<string, unknown> | null) => {
        const seenIds = new Set(
          groupedConversations
            .map((item) => Number(item?.id))
            .filter((id) => Number.isFinite(id) && id > 0),
        );
        const mergedConversations =
          stableExisting && stableExisting.id && !seenIds.has(Number(stableExisting.id))
            ? groupedConversations.concat([{ ...stableExisting, __threadId: threadId }])
            : groupedConversations;

        let keepConversation: Record<string, unknown> | null = null;
        if (stableExisting?.id) {
          keepConversation = stableExisting;
        } else {
          for (const conversation of mergedConversations) {
            if (String(conversation.conversationKey || '') === stableKey) {
              keepConversation = conversation;
              break;
            }
          }
        }
        if (!keepConversation) {
          keepConversation =
            mergedConversations
              .slice()
              .sort((a, b) => {
                const at = Number(a?.lastCapturedAt) || 0;
                const bt = Number(b?.lastCapturedAt) || 0;
                if (bt !== at) return bt - at;
                const aid = Number(a?.id) || 0;
                const bid = Number(b?.id) || 0;
                return bid - aid;
              })[0] || null;
        }

        const keepId = keepConversation?.id ? Number(keepConversation.id) : 0;
        if (!Number.isFinite(keepId) || keepId <= 0) {
          processNextThread();
          return;
        }

        try {
          const keepReq = conversationsStore.get(keepId);
          keepReq.onsuccess = () => {
            const current = keepReq.result as Record<string, unknown> | undefined;
            const legacyKeepKey = current ? String(current.conversationKey || '') : '';

            if (current) {
              let changed = false;
              if (String(current.conversationKey || '') !== stableKey) {
                current.conversationKey = stableKey;
                changed = true;
              }
              if (canonicalUrl && String(current.url || '') !== canonicalUrl) {
                current.url = canonicalUrl;
                changed = true;
              }
              if (changed) conversationsStore.put(current);
            }

            migrateMappingKey({
              legacyKey: legacyKeepKey,
              stableKey,
              onDone: () => {
                const duplicates = mergedConversations.filter(
                  (conversation) => Number(conversation?.id) !== keepId,
                );
                let duplicateIndex = 0;

                const processNextDup = () => {
                  if (duplicateIndex >= duplicates.length) {
                    processNextThread();
                    return;
                  }
                  const duplicate = duplicates[duplicateIndex];
                  duplicateIndex += 1;

                  const duplicateId = duplicate?.id ? Number(duplicate.id) : 0;
                  if (!Number.isFinite(duplicateId) || duplicateId <= 0) {
                    processNextDup();
                    return;
                  }

                  const legacyKey = String(duplicate.conversationKey || '');
                  migrateMessagesFromDupToKeep({
                    dupId: duplicateId,
                    keepId,
                    onDone: ({ ok }) => {
                      if (!ok) {
                        try {
                          const dupReq = conversationsStore.get(duplicateId);
                          dupReq.onsuccess = () => {
                            const dupRec = dupReq.result as Record<string, unknown> | undefined;
                            if (dupRec && canonicalUrl && String(dupRec.url || '') !== canonicalUrl) {
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
                          conversationsStore.delete(duplicateId);
                          processNextDup();
                        },
                      });
                    },
                  });
                };

                processNextDup();
              },
            });
          };
          keepReq.onerror = () => processNextThread();
        } catch (_e) {
          processNextThread();
        }
      };

      const stableReq = convoKeyIdx.get(['notionai', stableKey]);
      stableReq.onsuccess = () =>
        proceedWithStableExisting(
          (stableReq.result as Record<string, unknown> | undefined) || null,
        );
      stableReq.onerror = () => proceedWithStableExisting(null);
    };

    processNextThread();
  };
}

function ensureConversationsStore(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains('conversations')) {
    const store = db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
    store.createIndex('by_source_conversationKey', ['source', 'conversationKey'], { unique: true });
    store.createIndex('by_lastCapturedAt', 'lastCapturedAt', { unique: false });
    return;
  }

  if (!tx) return;
  const store = tx.objectStore('conversations');
  if (!store.indexNames.contains('by_source_conversationKey')) {
    store.createIndex('by_source_conversationKey', ['source', 'conversationKey'], { unique: true });
  }
  if (!store.indexNames.contains('by_lastCapturedAt')) {
    store.createIndex('by_lastCapturedAt', 'lastCapturedAt', { unique: false });
  }
}

function ensureMessagesStore(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains('messages')) {
    const store = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
    store.createIndex('by_conversationId_sequence', ['conversationId', 'sequence'], {
      unique: false,
    });
    store.createIndex('by_conversationId_messageKey', ['conversationId', 'messageKey'], {
      unique: true,
    });
    return;
  }

  if (!tx) return;
  const store = tx.objectStore('messages');
  if (!store.indexNames.contains('by_conversationId_sequence')) {
    store.createIndex('by_conversationId_sequence', ['conversationId', 'sequence'], {
      unique: false,
    });
  }
  if (!store.indexNames.contains('by_conversationId_messageKey')) {
    store.createIndex('by_conversationId_messageKey', ['conversationId', 'messageKey'], {
      unique: true,
    });
  }
}

function ensureSyncMappingsStore(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains('sync_mappings')) {
    const store = db.createObjectStore('sync_mappings', { keyPath: 'id', autoIncrement: true });
    store.createIndex('by_source_conversationKey', ['source', 'conversationKey'], {
      unique: true,
    });
    store.createIndex('by_notionPageId', 'notionPageId', { unique: false });
    return;
  }

  if (!tx) return;
  const store = tx.objectStore('sync_mappings');
  if (!store.indexNames.contains('by_source_conversationKey')) {
    store.createIndex('by_source_conversationKey', ['source', 'conversationKey'], {
      unique: true,
    });
  }
  if (!store.indexNames.contains('by_notionPageId')) {
    store.createIndex('by_notionPageId', 'notionPageId', { unique: false });
  }
}

function runUpgrades(request: IDBOpenDBRequest, oldVersion: number): void {
  const db = request.result;
  const tx = request.transaction;

  ensureConversationsStore(db, tx);
  ensureMessagesStore(db, tx);
  ensureSyncMappingsStore(db, tx);

  if (tx && oldVersion < 2) {
    try {
      migrateNotionAiThreadConversations({ db, tx });
    } catch (_e) {
      // ignore migration failures to avoid open abortion
    }
  }
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error('indexeddb open failed'));
    req.onupgradeneeded = (event) => {
      const oldVersion = typeof event.oldVersion === 'number' ? event.oldVersion : 0;
      runUpgrades(req, oldVersion);
    };
    req.onsuccess = () => resolve(req.result);
  });
}
