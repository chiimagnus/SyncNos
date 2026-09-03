import { normalizeConversationListRecord } from '@platform/idb/conversation-list-record';
import { DATA_REVISION_SCOPES, DATA_REVISION_STORE_BY_SCOPE } from '@platform/idb/data-revision-record';
import {
  GITHUB_CLEANUP_OUTBOX_DUE_INDEX,
  GITHUB_CLEANUP_OUTBOX_STORE,
} from '@platform/idb/github-cleanup-outbox-record';
import { mergeSyncMappingForIdentityMove } from '@platform/idb/sync-mapping-record';

export const DB_NAME = 'webclipper';
export const DB_VERSION = 11;

type MigrationContext = {
  db: IDBDatabase;
  tx: IDBTransaction;
};

type MigrationDone = (result: { ok: boolean }) => void;

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeHttpUrl(raw: unknown): string {
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

function articleStableConversationKey(url: string): string {
  return url ? `article:${url}` : '';
}

function mergeStringArray(base: unknown, incoming: unknown): string[] {
  const values = new Set<string>();
  const pushAll = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const normalized = safeString(item);
      if (normalized) values.add(normalized);
    }
  };
  pushAll(base);
  pushAll(incoming);
  return Array.from(values);
}

function normalizeConversationRecordsForV11({ db, tx }: MigrationContext): void {
  if (!db.objectStoreNames.contains('conversations')) return;
  const conversationsStore = tx.objectStore('conversations');
  const req = conversationsStore.openCursor();
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    const value = (cursor.value || {}) as Record<string, unknown>;
    const normalized = normalizeConversationListRecord(value);
    const next = { ...normalized } as Record<string, unknown>;
    let changed = normalized !== value;
    for (const key of ['description', '__canonicalUrl', '__canonicalKey']) {
      if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
      delete next[key];
      changed = true;
    }
    if (changed) cursor.update(next as any);
    cursor.continue();
  };
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
  return threadId ? `https://app.notion.com/chat?t=${threadId}&wfv=chat` : '';
}

function migrateNotionAiThreadConversations({ db, tx }: MigrationContext, onDone: () => void): void {
  if (!db.objectStoreNames.contains('conversations')) return onDone();
  if (!db.objectStoreNames.contains('messages')) return onDone();
  if (!db.objectStoreNames.contains('sync_mappings')) return onDone();

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
    return onDone();
  }
  if (!msgSeqIdx || !msgKeyIdx || !mappingIdx || !convoKeyIdx) return onDone();
  const messagesBySequenceIndex = msgSeqIdx;
  const messagesByKeyIndex = msgKeyIdx;
  const mappingsBySourceConversationKeyIndex = mappingIdx;

  function migrateMappingKey(input: { legacyKey: string; stableKey: string; onDone: MigrationDone }): void {
    const { legacyKey, stableKey, onDone } = input;
    if (!legacyKey || legacyKey === stableKey) {
      onDone({ ok: true });
      return;
    }

    const mapReq = mappingsBySourceConversationKeyIndex.get(['notionai', legacyKey]);
    mapReq.onsuccess = () => {
      const mapping = mapReq.result as Record<string, unknown> | undefined;
      if (!mapping) {
        onDone({ ok: true });
        return;
      }

      const targetReq = mappingsBySourceConversationKeyIndex.get(['notionai', stableKey]);
      targetReq.onsuccess = () => {
        const target = (targetReq.result as Record<string, unknown> | undefined) || null;
        const merged = mergeSyncMappingForIdentityMove(target, mapping, {
          source: 'notionai',
          conversationKey: stableKey,
        });
        mappingsStore.put(merged);
        if (target) {
          const mappingId = Number((mapping as { id?: unknown }).id);
          if (Number.isFinite(mappingId) && mappingId > 0 && mappingId !== Number((target as { id?: unknown }).id)) {
            mappingsStore.delete(mappingId);
          }
        }
        onDone({ ok: true });
      };
      targetReq.onerror = () => onDone({ ok: false });
    };
    mapReq.onerror = () => onDone({ ok: false });
  }

  function migrateMessagesFromDupToKeep(input: { dupId: number; keepId: number; onDone: MigrationDone }): void {
    const { dupId, keepId, onDone } = input;
    let ok = true;

    function done() {
      onDone({ ok });
    }

    const keyRangeApi = globalThis.IDBKeyRange;
    const range = keyRangeApi?.bound ? keyRangeApi.bound([dupId, -Infinity], [dupId, Infinity]) : null;
    if (!range) {
      onDone({ ok: false });
      return;
    }

    try {
      const msgCursorReq = messagesBySequenceIndex.openCursor(range);
      msgCursorReq.onsuccess = () => {
        const cursor = msgCursorReq.result;
        if (!cursor) return done();

        const msg = cursor.value as Record<string, unknown> | undefined;
        const messageKey = msg?.messageKey ? String(msg.messageKey) : '';
        if (!messageKey || !msg) {
          cursor.delete();
          cursor.continue();
          return;
        }

        const existsReq = messagesByKeyIndex.get([keepId, messageKey]);
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
      msgCursorReq.onerror = () => onDone({ ok: false });
    } catch (_e) {
      onDone({ ok: false });
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
      if (threadIndex >= threads.length) return onDone();
      const [threadId, groupedConversations] = threads[threadIndex];
      threadIndex += 1;

      const stableKey = notionAiStableConversationKey(threadId);
      const canonicalUrl = notionAiCanonicalChatUrl(threadId);

      const proceedWithStableExisting = (stableExisting: Record<string, unknown> | null) => {
        const seenIds = new Set(
          groupedConversations.map((item) => Number(item?.id)).filter((id) => Number.isFinite(id) && id > 0),
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
            mergedConversations.slice().sort((a, b) => {
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
                const duplicates = mergedConversations.filter((conversation) => Number(conversation?.id) !== keepId);
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
        proceedWithStableExisting((stableReq.result as Record<string, unknown> | undefined) || null);
      stableReq.onerror = () => proceedWithStableExisting(null);
    };

    processNextThread();
  };
  cursorReq.onerror = () => onDone();
}

function migrateLegacyArticleConversations({ db, tx }: MigrationContext, onDone: () => void): void {
  if (!db.objectStoreNames.contains('conversations')) return onDone();
  if (!db.objectStoreNames.contains('messages')) return onDone();
  if (!db.objectStoreNames.contains('sync_mappings')) return onDone();

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
    return onDone();
  }
  if (!msgSeqIdx || !msgKeyIdx || !mappingIdx || !convoKeyIdx) return onDone();

  const messagesBySequenceIndex = msgSeqIdx;
  const messagesByKeyIndex = msgKeyIdx;
  const mappingsBySourceConversationKeyIndex = mappingIdx;
  const articleConversations: Array<Record<string, unknown> & { __canonicalUrl?: string; __canonicalKey?: string }> =
    [];

  function mergeConversationRecord(base: Record<string, unknown>, incoming: Record<string, unknown>) {
    const next = { ...base };
    next.sourceType = 'article';
    next.source = 'web';
    next.conversationKey = safeString(base.__canonicalKey || incoming.__canonicalKey || base.conversationKey);
    next.url = safeString(base.__canonicalUrl || incoming.__canonicalUrl || base.url || incoming.url);
    next.title = safeString(next.title) || safeString(incoming.title);
    next.author = safeString(next.author) || safeString(incoming.author);
    next.publishedAt = safeString(next.publishedAt) || safeString(incoming.publishedAt);
    next.notionPageId = safeString(next.notionPageId) || safeString(incoming.notionPageId);
    next.warningFlags = mergeStringArray(next.warningFlags, incoming.warningFlags);
    next.lastCapturedAt = pickMaxFiniteNumber(next.lastCapturedAt, incoming.lastCapturedAt) || Date.now();
    return next;
  }

  function migrateMessagesFromDupToKeep(input: { dupId: number; keepId: number; onDone: MigrationDone }): void {
    const { dupId, keepId, onDone } = input;
    let ok = true;

    function done() {
      onDone({ ok });
    }

    const keyRangeApi = globalThis.IDBKeyRange;
    const range = keyRangeApi?.bound ? keyRangeApi.bound([dupId, -Infinity], [dupId, Infinity]) : null;
    if (!range) {
      onDone({ ok: false });
      return;
    }

    try {
      const cursorReq = messagesBySequenceIndex.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return done();

        const msg = cursor.value as Record<string, unknown> | undefined;
        const messageKey = safeString(msg?.messageKey);
        if (!messageKey || !msg) {
          cursor.delete();
          cursor.continue();
          return;
        }

        const existsReq = messagesByKeyIndex.get([keepId, messageKey]);
        existsReq.onsuccess = () => {
          const existing = existsReq.result;
          if (existing) cursor.delete();
          else {
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
      onDone({ ok: false });
    }
  }

  function migrateMappingToCanonical(input: {
    legacySource: string;
    legacyKey: string;
    canonicalKey: string;
    fallbackNotionPageId: string;
    onDone: MigrationDone;
  }): void {
    const legacySource = safeString(input.legacySource);
    const legacyKey = safeString(input.legacyKey);
    const canonicalKey = safeString(input.canonicalKey);
    const fallbackNotionPageId = safeString(input.fallbackNotionPageId);

    if (!canonicalKey) {
      input.onDone({ ok: true });
      return;
    }

    const targetReq = mappingsBySourceConversationKeyIndex.get(['web', canonicalKey]);
    targetReq.onsuccess = () => {
      const target = (targetReq.result as Record<string, unknown> | undefined) || null;

      const identity = { source: 'web', conversationKey: canonicalKey, fallbackNotionPageId };
      if (!legacySource || !legacyKey || (legacySource === 'web' && legacyKey === canonicalKey)) {
        if (!target) {
          input.onDone({ ok: true });
          return;
        }
        const merged = mergeSyncMappingForIdentityMove(target, null, identity);
        if (JSON.stringify(merged) !== JSON.stringify(target)) mappingsStore.put(merged);
        input.onDone({ ok: true });
        return;
      }

      const legacyReq = mappingsBySourceConversationKeyIndex.get([legacySource, legacyKey]);
      legacyReq.onsuccess = () => {
        const legacy = (legacyReq.result as Record<string, unknown> | undefined) || null;
        if (!legacy) {
          if (target) {
            const merged = mergeSyncMappingForIdentityMove(target, null, identity);
            if (JSON.stringify(merged) !== JSON.stringify(target)) mappingsStore.put(merged);
          }
          input.onDone({ ok: true });
          return;
        }

        if (!target) {
          mappingsStore.put(mergeSyncMappingForIdentityMove(null, legacy, identity));
          input.onDone({ ok: true });
          return;
        }

        const merged = mergeSyncMappingForIdentityMove(target, legacy, identity);
        mappingsStore.put(merged);
        const legacyId = Number((legacy as { id?: unknown }).id);
        if (Number.isFinite(legacyId) && legacyId > 0 && legacyId !== Number((target as { id?: unknown }).id)) {
          mappingsStore.delete(legacyId);
        }
        input.onDone({ ok: true });
      };
      legacyReq.onerror = () => input.onDone({ ok: false });
    };
    targetReq.onerror = () => input.onDone({ ok: false });
  }

  const cursorReq = conversationsStore.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (cursor) {
      const row = cursor.value as Record<string, unknown> | undefined;
      if (safeString(row?.sourceType).toLowerCase() === 'article') {
        const canonicalUrl = normalizeHttpUrl(row?.url);
        const canonicalKey = articleStableConversationKey(canonicalUrl);
        if (canonicalUrl && canonicalKey) {
          articleConversations.push({
            ...(row || {}),
            __canonicalUrl: canonicalUrl,
            __canonicalKey: canonicalKey,
          });
        }
      }
      cursor.continue();
      return;
    }

    const groups = new Map<
      string,
      Array<Record<string, unknown> & { __canonicalUrl?: string; __canonicalKey?: string }>
    >();
    for (const conversation of articleConversations) {
      const key = safeString(conversation.__canonicalKey);
      if (!key) continue;
      const list = groups.get(key) || [];
      list.push(conversation);
      groups.set(key, list);
    }

    const entries = Array.from(groups.entries());
    let groupIndex = 0;

    const processNextGroup = () => {
      if (groupIndex >= entries.length) return onDone();
      const [canonicalKey, groupedConversations] = entries[groupIndex];
      groupIndex += 1;
      const canonicalUrl = safeString(groupedConversations[0]?.__canonicalUrl);

      const exactReq = convoKeyIdx.get(['web', canonicalKey]);
      exactReq.onsuccess = () => {
        const exact = (exactReq.result as Record<string, unknown> | undefined) || null;
        const seenIds = new Set(
          groupedConversations.map((item) => Number(item?.id)).filter((id) => Number.isFinite(id) && id > 0),
        );
        const mergedConversations =
          exact && exact.id && !seenIds.has(Number(exact.id))
            ? groupedConversations.concat([{ ...exact, __canonicalUrl: canonicalUrl, __canonicalKey: canonicalKey }])
            : groupedConversations;

        const keepConversation =
          mergedConversations.slice().sort((a, b) => {
            const aCanonical =
              safeString(a?.source) === 'web' && safeString(a?.conversationKey) === canonicalKey ? 1 : 0;
            const bCanonical =
              safeString(b?.source) === 'web' && safeString(b?.conversationKey) === canonicalKey ? 1 : 0;
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
          })[0] || null;

        const keepId = Number(keepConversation?.id);
        if (!Number.isFinite(keepId) || keepId <= 0) {
          processNextGroup();
          return;
        }

        const keepReq = conversationsStore.get(keepId);
        keepReq.onsuccess = () => {
          const currentKeep = (keepReq.result as Record<string, unknown> | undefined) || {};
          const legacyKeepSource = safeString(currentKeep.source);
          const legacyKeepKey = safeString(currentKeep.conversationKey);

          let mergedKeep = {
            ...currentKeep,
            __canonicalUrl: canonicalUrl,
            __canonicalKey: canonicalKey,
          } as Record<string, unknown>;
          for (const conversation of mergedConversations) {
            mergedKeep = mergeConversationRecord(mergedKeep, conversation);
          }
          delete mergedKeep.__canonicalUrl;
          delete mergedKeep.__canonicalKey;
          mergedKeep = normalizeConversationListRecord(mergedKeep) as Record<string, unknown>;
          conversationsStore.put(mergedKeep);

          migrateMappingToCanonical({
            legacySource: legacyKeepSource,
            legacyKey: legacyKeepKey,
            canonicalKey,
            fallbackNotionPageId: safeString(mergedKeep.notionPageId),
            onDone: () => {
              const duplicates = mergedConversations.filter((conversation) => Number(conversation?.id) !== keepId);
              let duplicateIndex = 0;

              const processNextDuplicate = () => {
                if (duplicateIndex >= duplicates.length) {
                  processNextGroup();
                  return;
                }
                const duplicate = duplicates[duplicateIndex];
                duplicateIndex += 1;

                const duplicateId = Number(duplicate?.id);
                if (!Number.isFinite(duplicateId) || duplicateId <= 0) {
                  processNextDuplicate();
                  return;
                }

                migrateMessagesFromDupToKeep({
                  dupId: duplicateId,
                  keepId,
                  onDone: () => {
                    migrateMappingToCanonical({
                      legacySource: safeString(duplicate?.source),
                      legacyKey: safeString(duplicate?.conversationKey),
                      canonicalKey,
                      fallbackNotionPageId: safeString(mergedKeep.notionPageId),
                      onDone: () => {
                        conversationsStore.delete(duplicateId);
                        processNextDuplicate();
                      },
                    });
                  },
                });
              };

              processNextDuplicate();
            },
          });
        };
        keepReq.onerror = () => processNextGroup();
      };
      exactReq.onerror = () => processNextGroup();
    };

    processNextGroup();
  };
  cursorReq.onerror = () => onDone();
}

function ensureConversationsStore(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains('conversations')) {
    const store = db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
    store.createIndex('by_source_conversationKey', ['source', 'conversationKey'], { unique: true });
    store.createIndex('by_lastCapturedAt', 'lastCapturedAt', { unique: false });
    store.createIndex('by_lastCapturedAt_id', ['lastCapturedAt', 'id'], { unique: false });
    store.createIndex('by_listSourceKey_lastCapturedAt_id', ['listSourceKey', 'lastCapturedAt', 'id'], {
      unique: false,
    });
    store.createIndex(
      'by_listSourceKey_listSiteKey_lastCapturedAt_id',
      ['listSourceKey', 'listSiteKey', 'lastCapturedAt', 'id'],
      { unique: false },
    );
    store.createIndex('by_listSiteKey_lastCapturedAt_id', ['listSiteKey', 'lastCapturedAt', 'id'], {
      unique: false,
    });
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
  if (!store.indexNames.contains('by_lastCapturedAt_id')) {
    store.createIndex('by_lastCapturedAt_id', ['lastCapturedAt', 'id'], { unique: false });
  }
  if (!store.indexNames.contains('by_listSourceKey_lastCapturedAt_id')) {
    store.createIndex('by_listSourceKey_lastCapturedAt_id', ['listSourceKey', 'lastCapturedAt', 'id'], {
      unique: false,
    });
  }
  if (!store.indexNames.contains('by_listSourceKey_listSiteKey_lastCapturedAt_id')) {
    store.createIndex(
      'by_listSourceKey_listSiteKey_lastCapturedAt_id',
      ['listSourceKey', 'listSiteKey', 'lastCapturedAt', 'id'],
      { unique: false },
    );
  }
  if (!store.indexNames.contains('by_listSiteKey_lastCapturedAt_id')) {
    store.createIndex('by_listSiteKey_lastCapturedAt_id', ['listSiteKey', 'lastCapturedAt', 'id'], {
      unique: false,
    });
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

function ensureImageCacheStore(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains('image_cache')) {
    const store = db.createObjectStore('image_cache', { keyPath: 'id', autoIncrement: true });
    store.createIndex('by_conversationId_url', ['conversationId', 'url'], { unique: true });
    store.createIndex('by_conversationId', 'conversationId', { unique: false });
    return;
  }

  if (!tx) return;
  const store = tx.objectStore('image_cache');
  if (!store.indexNames.contains('by_conversationId_url')) {
    store.createIndex('by_conversationId_url', ['conversationId', 'url'], { unique: true });
  }
  if (!store.indexNames.contains('by_conversationId')) {
    store.createIndex('by_conversationId', 'conversationId', { unique: false });
  }
}

function ensureArticleCommentsStore(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains('article_comments')) {
    const store = db.createObjectStore('article_comments', { keyPath: 'id', autoIncrement: true });
    store.createIndex('by_canonicalUrl_createdAt', ['canonicalUrl', 'createdAt'], { unique: false });
    store.createIndex('by_conversationId_createdAt', ['conversationId', 'createdAt'], { unique: false });
    return;
  }

  if (!tx) return;
  const store = tx.objectStore('article_comments');
  if (!store.indexNames.contains('by_canonicalUrl_createdAt')) {
    store.createIndex('by_canonicalUrl_createdAt', ['canonicalUrl', 'createdAt'], { unique: false });
  }
  if (!store.indexNames.contains('by_conversationId_createdAt')) {
    store.createIndex('by_conversationId_createdAt', ['conversationId', 'createdAt'], { unique: false });
  }
}

function ensureGithubCleanupOutboxStore(db: IDBDatabase, tx: IDBTransaction | null): void {
  if (!db.objectStoreNames.contains(GITHUB_CLEANUP_OUTBOX_STORE)) {
    const store = db.createObjectStore(GITHUB_CLEANUP_OUTBOX_STORE, { keyPath: 'id', autoIncrement: true });
    store.createIndex(GITHUB_CLEANUP_OUTBOX_DUE_INDEX, ['remoteKey', 'nextAttemptAt', 'createdAt'], { unique: false });
    return;
  }

  if (!tx) return;
  const store = tx.objectStore(GITHUB_CLEANUP_OUTBOX_STORE);
  if (!store.indexNames.contains(GITHUB_CLEANUP_OUTBOX_DUE_INDEX)) {
    store.createIndex(GITHUB_CLEANUP_OUTBOX_DUE_INDEX, ['remoteKey', 'nextAttemptAt', 'createdAt'], { unique: false });
  }
}

function ensureDataRevisionStores(db: IDBDatabase): void {
  for (const scope of DATA_REVISION_SCOPES) {
    const storeName = DATA_REVISION_STORE_BY_SCOPE[scope];
    if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
  }
}

function runUpgrades(request: IDBOpenDBRequest, oldVersion: number): void {
  const db = request.result;
  const tx = request.transaction;

  ensureConversationsStore(db, tx);
  ensureMessagesStore(db, tx);
  ensureSyncMappingsStore(db, tx);
  ensureImageCacheStore(db, tx);
  ensureArticleCommentsStore(db, tx);
  ensureGithubCleanupOutboxStore(db, tx);
  ensureDataRevisionStores(db);

  if (!tx || oldVersion === 0 || oldVersion >= 11) return;

  const finish = () => normalizeConversationRecordsForV11({ db, tx });
  const migrateArticles = () => {
    if (oldVersion >= 4) return finish();
    try {
      migrateLegacyArticleConversations({ db, tx }, finish);
    } catch (_e) {
      finish();
    }
  };

  if (oldVersion >= 2) return migrateArticles();
  try {
    migrateNotionAiThreadConversations({ db, tx }, migrateArticles);
  } catch (_e) {
    migrateArticles();
  }
}

let cachedDb: IDBDatabase | null = null;
let openingDb: Promise<IDBDatabase> | null = null;
let dbLifecycleGeneration = 0;

function attachDbLifecycle(db: IDBDatabase, generation: number): void {
  db.onversionchange = () => {
    if (dbLifecycleGeneration !== generation || cachedDb !== db) return;
    dbLifecycleGeneration += 1;
    cachedDb = null;
    db.close();
  };

  db.addEventListener('close', () => {
    if (dbLifecycleGeneration !== generation || cachedDb !== db) return;
    dbLifecycleGeneration += 1;
    cachedDb = null;
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (cachedDb) return Promise.resolve(cachedDb);
  if (openingDb) return openingDb;

  const generation = dbLifecycleGeneration;
  let managedPromise: Promise<IDBDatabase>;
  const requestPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => {
      if (dbLifecycleGeneration !== generation || openingDb !== managedPromise) {
        reject(req.error || new Error('indexeddb open superseded'));
        return;
      }
      reject(req.error || new Error('indexeddb open failed'));
    };
    req.onblocked = () => {
      console.warn('[IndexedDB] open blocked', { database: DB_NAME, requestedVersion: DB_VERSION });
    };
    req.onupgradeneeded = (event) => {
      const oldVersion = typeof event.oldVersion === 'number' ? event.oldVersion : 0;
      runUpgrades(req, oldVersion);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (dbLifecycleGeneration !== generation || openingDb !== managedPromise) {
        db.close();
        reject(new Error('indexeddb open superseded'));
        return;
      }
      cachedDb = db;
      attachDbLifecycle(db, generation);
      resolve(db);
    };
  });

  managedPromise = requestPromise.finally(() => {
    if (dbLifecycleGeneration === generation && openingDb === managedPromise) openingDb = null;
  });
  openingDb = managedPromise;
  return managedPromise;
}

export function closeDbForTests(): void {
  dbLifecycleGeneration += 1;
  const db = cachedDb;
  cachedDb = null;
  openingDb = null;
  db?.close();
}
