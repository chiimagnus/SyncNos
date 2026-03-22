export const DB_NAME = 'webclipper';
export const DB_VERSION = 7;

type MigrationContext = {
  db: IDBDatabase;
  tx: IDBTransaction;
};

type MigrationDone = (result: { ok: boolean; changed?: boolean; hadAny?: boolean }) => void;

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

function stripConversationDescriptionField({ db, tx }: MigrationContext): void {
  if (!db.objectStoreNames.contains('conversations')) return;
  const conversationsStore = tx.objectStore('conversations');

  try {
    const req = conversationsStore.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const value = cursor.value as Record<string, unknown> | undefined;
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'description')) {
        const next = { ...(value as any) };
        delete (next as any).description;
        cursor.update(next as any);
      }
      cursor.continue();
    };
    req.onerror = () => {};
  } catch (_e) {
    // ignore
  }
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
  const messagesBySequenceIndex = msgSeqIdx;
  const messagesByKeyIndex = msgKeyIdx;
  const mappingsBySourceConversationKeyIndex = mappingIdx;

  function migrateMappingKey(input: { legacyKey: string; stableKey: string; onDone: MigrationDone }): void {
    const { legacyKey, stableKey, onDone } = input;
    if (!legacyKey || legacyKey === stableKey) {
      onDone({ ok: true, changed: false });
      return;
    }

    const mapReq = mappingsBySourceConversationKeyIndex.get(['notionai', legacyKey]);
    mapReq.onsuccess = () => {
      const mapping = mapReq.result as Record<string, unknown> | undefined;
      if (!mapping) {
        onDone({ ok: true, changed: false });
        return;
      }

      const targetReq = mappingsBySourceConversationKeyIndex.get(['notionai', stableKey]);
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

  function migrateMessagesFromDupToKeep(input: { dupId: number; keepId: number; onDone: MigrationDone }): void {
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
      const range = keyRangeApi?.bound ? keyRangeApi.bound([dupId, -Infinity], [dupId, Infinity]) : null;
      if (!range) {
        tryFallbackCursor();
        return;
      }

      const msgCursorReq = messagesBySequenceIndex.openCursor(range);
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
}

function migrateLegacyArticleConversations({ db, tx }: MigrationContext): void {
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

  function mergeMappingRecord(
    base: Record<string, unknown>,
    incoming: Record<string, unknown>,
    fallbackNotionPageId: string,
  ) {
    const next = { ...base };
    next.source = 'web';
    next.conversationKey = safeString(base.conversationKey || incoming.conversationKey);
    next.notionPageId =
      safeString(next.notionPageId) || safeString(incoming.notionPageId) || safeString(fallbackNotionPageId);
    next.lastSyncedMessageKey = safeString(next.lastSyncedMessageKey) || safeString(incoming.lastSyncedMessageKey);
    next.lastSyncedSequence = pickMaxFiniteNumber(next.lastSyncedSequence, incoming.lastSyncedSequence);
    next.lastSyncedAt = pickMaxFiniteNumber(next.lastSyncedAt, incoming.lastSyncedAt);
    next.lastSyncedMessageUpdatedAt = pickMaxFiniteNumber(
      next.lastSyncedMessageUpdatedAt,
      incoming.lastSyncedMessageUpdatedAt,
    );
    next.updatedAt = pickMaxFiniteNumber(next.updatedAt, incoming.updatedAt, Date.now()) || Date.now();
    return next;
  }

  function migrateMessagesFromDupToKeep(input: { dupId: number; keepId: number; onDone: MigrationDone }): void {
    const { dupId, keepId, onDone } = input;
    let hadAny = false;
    let ok = true;

    function done() {
      onDone({ ok, hadAny });
    }

    const keyRangeApi = globalThis.IDBKeyRange;
    const range = keyRangeApi?.bound ? keyRangeApi.bound([dupId, -Infinity], [dupId, Infinity]) : null;
    if (!range) {
      onDone({ ok: false, hadAny: false });
      return;
    }

    try {
      const cursorReq = messagesBySequenceIndex.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return done();
        hadAny = true;

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
      onDone({ ok: false, hadAny: false });
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
      input.onDone({ ok: true, changed: false });
      return;
    }

    const targetReq = mappingsBySourceConversationKeyIndex.get(['web', canonicalKey]);
    targetReq.onsuccess = () => {
      const target = (targetReq.result as Record<string, unknown> | undefined) || null;

      if (!legacySource || !legacyKey || (legacySource === 'web' && legacyKey === canonicalKey)) {
        if (!target) {
          input.onDone({ ok: true, changed: false });
          return;
        }
        const merged = mergeMappingRecord(target, {}, fallbackNotionPageId);
        mappingsStore.put(merged);
        input.onDone({ ok: true, changed: true });
        return;
      }

      const legacyReq = mappingsBySourceConversationKeyIndex.get([legacySource, legacyKey]);
      legacyReq.onsuccess = () => {
        const legacy = (legacyReq.result as Record<string, unknown> | undefined) || null;
        if (!legacy) {
          if (target) {
            const merged = mergeMappingRecord(target, {}, fallbackNotionPageId);
            mappingsStore.put(merged);
          }
          input.onDone({ ok: true, changed: false });
          return;
        }

        if (!target) {
          legacy.source = 'web';
          legacy.conversationKey = canonicalKey;
          mappingsStore.put(mergeMappingRecord(legacy, {}, fallbackNotionPageId));
          input.onDone({ ok: true, changed: true });
          return;
        }

        const merged = mergeMappingRecord(target, legacy, fallbackNotionPageId);
        mappingsStore.put(merged);
        const legacyId = Number((legacy as { id?: unknown }).id);
        if (Number.isFinite(legacyId) && legacyId > 0 && legacyId !== Number((target as { id?: unknown }).id)) {
          mappingsStore.delete(legacyId);
        }
        input.onDone({ ok: true, changed: true });
      };
      legacyReq.onerror = () => input.onDone({ ok: false, changed: false });
    };
    targetReq.onerror = () => input.onDone({ ok: false, changed: false });
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
      if (groupIndex >= entries.length) return;
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

function runUpgrades(request: IDBOpenDBRequest, oldVersion: number): void {
  const db = request.result;
  const tx = request.transaction;

  ensureConversationsStore(db, tx);
  ensureMessagesStore(db, tx);
  ensureSyncMappingsStore(db, tx);
  ensureImageCacheStore(db, tx);
  ensureArticleCommentsStore(db, tx);

  if (tx && oldVersion < 2) {
    try {
      migrateNotionAiThreadConversations({ db, tx });
    } catch (_e) {
      // ignore migration failures to avoid open abortion
    }
  }
  if (tx && oldVersion < 4) {
    try {
      migrateLegacyArticleConversations({ db, tx });
    } catch (_e) {
      // ignore migration failures to avoid open abortion
    }
  }
  if (tx && oldVersion < 6) {
    try {
      stripConversationDescriptionField({ db, tx });
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
