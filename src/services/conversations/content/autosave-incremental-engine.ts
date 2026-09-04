import {
  IDENTITY_PREFIX_LEN,
  classifyPrefixOrFillingUpdate,
  computeRequiredOverlap,
  computeSuffixPrefixOverlap,
  fingerprintHash,
  getMessageIdentityBase,
} from '@services/conversations/content/autosave-identity-utils.ts';

type Diff = { added: string[]; updated: string[]; removed: string[] };

type IncomingKeyIdentity = { role: string; text: string; markdown: string };

type TailEntry = {
  key: string;
  role: string;
  identityHash: string;
  text: string;
  markdown: string;
};

type ConversationState = {
  revision: number;
  lastTitle: string;
  lastUrl: string;
  stateKeyHash: string;
  lastWindowIdentityHashes: string[];
  lastTail: TailEntry[];
  incomingKeyIdentities: Map<string, IncomingKeyIdentity>;
};

type ConversationStateDraft = {
  lastTitle: string;
  lastUrl: string;
  lastWindowIdentityHashes: string[];
  lastTail: TailEntry[];
  incomingKeyOverlay: Map<string, IncomingKeyIdentity>;
};

type AutoSaveIncrementalPreparation = {
  changed: boolean;
  snapshot: any | null;
  diff: Diff;
  commit: () => boolean;
};

function normalizeMeta(value: unknown): string {
  return String(value || '').trim();
}

function makeConversationStateKey(snapshot: any): string {
  const source = normalizeMeta(snapshot?.conversation?.source);
  const conversationKey = normalizeMeta(snapshot?.conversation?.conversationKey);
  if (!source || !conversationKey) return '';
  return `${source}::${conversationKey}`;
}

function buildTailEntries(args: {
  prevTail: TailEntry[];
  curTail: Array<{ role: string; identityHash: string; text: string; markdown: string; stableIncomingKey: string }>;
  tailWindowMessages: any[];
  stateKeyHash: string;
}): TailEntry[] {
  const { prevTail, curTail, tailWindowMessages, stateKeyHash } = args;
  const usedPrev = new Set<number>();

  const pickPrevIndex = (cur: any): number => {
    const tryPick = (predicate: (p: TailEntry) => boolean): number => {
      for (let i = 0; i < prevTail.length; i += 1) {
        if (usedPrev.has(i)) continue;
        const p = prevTail[i];
        if (!p || !p.key) continue;
        if (predicate(p)) return i;
      }
      return -1;
    };

    const idx1 = tryPick((p) => p.role === cur.role && p.identityHash === cur.identityHash);
    if (idx1 >= 0) return idx1;

    const idx2 = tryPick((p) => p.role === cur.role && p.text === cur.text && p.markdown === cur.markdown);
    if (idx2 >= 0) return idx2;

    return tryPick((p) => {
      if (p.role !== cur.role) return false;
      const decision = classifyPrefixOrFillingUpdate(
        { text: p.text, markdown: p.markdown },
        { text: cur.text, markdown: cur.markdown },
      );
      return !decision.changed || decision.acceptable;
    });
  };

  const out: TailEntry[] = [];
  for (let i = 0; i < curTail.length; i += 1) {
    const cur = curTail[i];
    const msg = tailWindowMessages[i];
    const keyFromMsg = String(msg?.messageKey || '').trim();

    let key = cur?.stableIncomingKey || '';
    if (!key && keyFromMsg.startsWith(`autosave_${stateKeyHash}_`)) key = keyFromMsg;

    if (!key) {
      const prevIndex = pickPrevIndex(cur);
      if (prevIndex >= 0) {
        usedPrev.add(prevIndex);
        key = prevTail[prevIndex].key;
      }
    }

    out.push({
      key: key || '',
      role: cur.role,
      identityHash: cur.identityHash,
      text: cur.text,
      markdown: cur.markdown,
    });
  }

  return out;
}

function noOpPreparation(): AutoSaveIncrementalPreparation {
  return {
    changed: false,
    snapshot: null,
    diff: { added: [], updated: [], removed: [] },
    commit: () => false,
  };
}

export function createAutoSaveIncrementalEngine() {
  const byConversation = new Map<string, ConversationState>();
  const TAIL_UPDATE_WINDOW_SIZE = 2;
  const MAX_WINDOW_MESSAGES = 200;
  const SEED_MAX_MESSAGES = 6;

  function makePreparation(args: {
    stateKey: string;
    stateKeyHash: string;
    baseState: ConversationState | null;
    draft: ConversationStateDraft;
    changed: boolean;
    snapshot: any;
    diff: Diff;
  }): AutoSaveIncrementalPreparation {
    const { stateKey, stateKeyHash, baseState, draft, changed, snapshot, diff } = args;
    const baseRevision = baseState?.revision ?? 0;
    let committed = false;

    return {
      changed,
      snapshot,
      diff,
      commit() {
        if (committed) return false;

        const current = byConversation.get(stateKey) || null;
        if (baseState) {
          if (current !== baseState || current.revision !== baseRevision) {
            throw new Error('autosave_incremental_prepare_stale');
          }
        } else if (current) {
          throw new Error('autosave_incremental_prepare_stale');
        }

        if (baseState) {
          baseState.lastTitle = draft.lastTitle;
          baseState.lastUrl = draft.lastUrl;
          baseState.lastWindowIdentityHashes = draft.lastWindowIdentityHashes;
          baseState.lastTail = draft.lastTail;
          for (const [key, identity] of draft.incomingKeyOverlay) {
            baseState.incomingKeyIdentities.set(key, identity);
          }
          baseState.revision += 1;
        } else {
          byConversation.set(stateKey, {
            revision: 1,
            lastTitle: draft.lastTitle,
            lastUrl: draft.lastUrl,
            stateKeyHash,
            lastWindowIdentityHashes: draft.lastWindowIdentityHashes,
            lastTail: draft.lastTail,
            incomingKeyIdentities: new Map(draft.incomingKeyOverlay),
          });
        }

        committed = true;
        return true;
      },
    };
  }

  return {
    prepare(inputSnapshot: any): AutoSaveIncrementalPreparation {
      if (!inputSnapshot || !inputSnapshot.conversation) return noOpPreparation();

      const stateKey = makeConversationStateKey(inputSnapshot);
      if (!stateKey) return noOpPreparation();

      const baseState = byConversation.get(stateKey) || null;
      const stateKeyHash = baseState?.stateKeyHash || fingerprintHash(stateKey);
      const effectiveConversation = { ...(inputSnapshot.conversation || {}) };
      if (baseState) {
        if (!normalizeMeta(effectiveConversation.title) && baseState.lastTitle)
          effectiveConversation.title = baseState.lastTitle;
        if (!normalizeMeta(effectiveConversation.url) && baseState.lastUrl)
          effectiveConversation.url = baseState.lastUrl;
      }

      const nextTitle = normalizeMeta(effectiveConversation.title);
      const nextUrl = normalizeMeta(effectiveConversation.url);
      const metaChanged = !!baseState && (nextTitle !== baseState.lastTitle || nextUrl !== baseState.lastUrl);

      const allMessages = Array.isArray(inputSnapshot.messages) ? inputSnapshot.messages : [];
      const windowStart = Math.max(0, allMessages.length - MAX_WINDOW_MESSAGES);
      const windowMessages = allMessages.slice(windowStart);
      const currentIdentityHashes: string[] = [];
      const currentComparable: Array<{
        role: string;
        identityHash: string;
        text: string;
        markdown: string;
        stableIncomingKey: string;
      }> = [];
      const incomingKeyOverlay = new Map<string, IncomingKeyIdentity>();

      const readIncomingKeyIdentity = (key: string): IncomingKeyIdentity | undefined =>
        incomingKeyOverlay.get(key) || baseState?.incomingKeyIdentities.get(key);

      for (const message of windowMessages) {
        const incomingKeyRaw = String(message?.messageKey || '').trim();
        const { role, base, text, markdown } = getMessageIdentityBase(message, IDENTITY_PREFIX_LEN);
        const identityHash = fingerprintHash(base);
        const fallbackIncomingKey = incomingKeyRaw.startsWith('fallback_');

        let stableIncomingKey = '';
        if (incomingKeyRaw && !fallbackIncomingKey) {
          const existing = readIncomingKeyIdentity(incomingKeyRaw);
          if (!existing) {
            incomingKeyOverlay.set(incomingKeyRaw, { role, text, markdown });
            stableIncomingKey = incomingKeyRaw;
          } else if (existing.role === role) {
            const decision = classifyPrefixOrFillingUpdate(existing, { text, markdown });
            if (decision.acceptable) {
              incomingKeyOverlay.set(incomingKeyRaw, { role, text, markdown });
              stableIncomingKey = incomingKeyRaw;
            }
          }
        }

        currentIdentityHashes.push(identityHash);
        currentComparable.push({ role, identityHash, text, markdown, stableIncomingKey });
      }

      const baseLastWindowIdentityHashes = baseState?.lastWindowIdentityHashes || [];
      const baseLastTail = baseState?.lastTail || [];
      let nextLastWindowIdentityHashes = baseLastWindowIdentityHashes;
      let nextLastTail = baseLastTail;
      const assignedKeyByWindowIndex = new Map<number, string>();
      const added: string[] = [];
      const updated: string[] = [];
      const addedSet = new Set<string>();
      const updatedSet = new Set<string>();
      const deltaByKey = new Map<string, any>();

      const materializeMessage = (index: number, key: string) => {
        const message = windowMessages[index];
        if (!message) return null;
        assignedKeyByWindowIndex.set(index, key);
        return { ...message, messageKey: key };
      };

      const pushDelta = (key: string, index: number, kind: 'added' | 'updated') => {
        if (!key) return;
        const message = materializeMessage(index, key);
        if (!message) return;
        if (!deltaByKey.has(key)) deltaByKey.set(key, message);
        if (kind === 'added') {
          if (!addedSet.has(key)) {
            addedSet.add(key);
            added.push(key);
          }
          return;
        }
        if (!updatedSet.has(key)) {
          updatedSet.add(key);
          updated.push(key);
        }
      };

      if (!baseState) {
        nextLastWindowIdentityHashes = currentIdentityHashes;
        nextLastTail = currentComparable
          .slice(Math.max(0, currentComparable.length - TAIL_UPDATE_WINDOW_SIZE))
          .map((message) => ({
            key: message.stableIncomingKey || '',
            role: message.role,
            identityHash: message.identityHash,
            text: message.text,
            markdown: message.markdown,
          }));

        if (windowMessages.length > 0 && windowMessages.length <= SEED_MAX_MESSAGES) {
          const occurrenceByIdentity = new Map<string, number>();
          for (let index = 0; index < windowMessages.length; index += 1) {
            const meta = currentComparable[index];
            if (!meta || !windowMessages[index]) continue;
            const keyFromCollector = meta.stableIncomingKey;
            const key = keyFromCollector
              ? keyFromCollector
              : `autosave_${stateKeyHash}_${meta.identityHash}_s${(occurrenceByIdentity.get(meta.identityHash) || 0) + 1}`;
            if (!keyFromCollector) {
              occurrenceByIdentity.set(meta.identityHash, (occurrenceByIdentity.get(meta.identityHash) || 0) + 1);
            }
            pushDelta(key, index, 'added');
          }

          const curTail = currentComparable.slice(Math.max(0, currentComparable.length - TAIL_UPDATE_WINDOW_SIZE));
          const tailStart = Math.max(0, windowMessages.length - curTail.length);
          nextLastTail = curTail.map((message, index) => ({
            key: assignedKeyByWindowIndex.get(tailStart + index) || message.stableIncomingKey || '',
            role: message.role,
            identityHash: message.identityHash,
            text: message.text,
            markdown: message.markdown,
          }));

          return makePreparation({
            stateKey,
            stateKeyHash,
            baseState,
            draft: {
              lastTitle: nextTitle,
              lastUrl: nextUrl,
              lastWindowIdentityHashes: nextLastWindowIdentityHashes,
              lastTail: nextLastTail,
              incomingKeyOverlay,
            },
            changed: true,
            snapshot: {
              ...inputSnapshot,
              conversation: effectiveConversation,
              messages: Array.from(deltaByKey.values()),
            },
            diff: { added, updated: [], removed: [] },
          });
        }

        return makePreparation({
          stateKey,
          stateKeyHash,
          baseState,
          draft: {
            lastTitle: nextTitle,
            lastUrl: nextUrl,
            lastWindowIdentityHashes: nextLastWindowIdentityHashes,
            lastTail: nextLastTail,
            incomingKeyOverlay,
          },
          changed: false,
          snapshot: { ...inputSnapshot, conversation: effectiveConversation, messages: [] },
          diff: { added: [], updated: [], removed: [] },
        });
      }

      const prevIdentityHashes = baseState.lastWindowIdentityHashes;
      const curLen = currentIdentityHashes.length;
      const prevLen = prevIdentityHashes.length;
      const requiredOverlap = computeRequiredOverlap(prevLen, curLen);
      const overlapLen = computeSuffixPrefixOverlap(prevIdentityHashes, currentIdentityHashes, requiredOverlap);
      const curTail = currentComparable.slice(Math.max(0, currentComparable.length - TAIL_UPDATE_WINDOW_SIZE));
      const prevTail = baseState.lastTail;
      const curTailWindowStart = Math.max(0, windowMessages.length - curTail.length);

      for (let index = 0; index < curTail.length; index += 1) {
        const prevEntry = prevTail[index];
        const curEntry = curTail[index];
        if (!prevEntry || !curEntry || prevEntry.role !== curEntry.role) continue;
        const decision = classifyPrefixOrFillingUpdate(
          { text: prevEntry.text || '', markdown: prevEntry.markdown || '' },
          { text: curEntry.text, markdown: curEntry.markdown },
        );
        if (!decision.changed || !decision.acceptable) continue;

        const messageIndexFromEnd = curTail.length - 1 - index;
        const key =
          curEntry.stableIncomingKey ||
          prevEntry.key ||
          `autosave_${stateKeyHash}_${curEntry.identityHash}_tail${messageIndexFromEnd + 1}`;
        pushDelta(key, curTailWindowStart + index, prevEntry.key ? 'updated' : 'added');
      }

      if (prevLen === 0 || overlapLen > 0) {
        const occurrenceByIdentity = new Map<string, number>();
        for (let index = overlapLen; index < windowMessages.length; index += 1) {
          const meta = currentComparable[index];
          if (!meta || !windowMessages[index]) continue;
          if (meta.stableIncomingKey) {
            pushDelta(meta.stableIncomingKey, index, 'added');
            continue;
          }
          const nextOccurrence = (occurrenceByIdentity.get(meta.identityHash) || 0) + 1;
          occurrenceByIdentity.set(meta.identityHash, nextOccurrence);
          pushDelta(`autosave_${stateKeyHash}_${meta.identityHash}_a${nextOccurrence}`, index, 'added');
        }
      }

      const changed = metaChanged || added.length > 0 || updated.length > 0;
      if (!changed) {
        if (prevLen === 0 || overlapLen > 0) {
          nextLastWindowIdentityHashes = currentIdentityHashes;
          const tailWindowMessages = windowMessages.slice(curTailWindowStart).map((message: any, index: number) => {
            const key = assignedKeyByWindowIndex.get(curTailWindowStart + index);
            return key ? { ...message, messageKey: key } : message;
          });
          nextLastTail = buildTailEntries({
            prevTail,
            curTail,
            tailWindowMessages,
            stateKeyHash,
          });
        }
      } else {
        nextLastWindowIdentityHashes = currentIdentityHashes;
        const tailWindowMessages = windowMessages.slice(curTailWindowStart).map((message: any, index: number) => {
          const key = assignedKeyByWindowIndex.get(curTailWindowStart + index);
          return key ? { ...message, messageKey: key } : message;
        });
        nextLastTail = buildTailEntries({
          prevTail,
          curTail,
          tailWindowMessages,
          stateKeyHash,
        });
      }

      return makePreparation({
        stateKey,
        stateKeyHash,
        baseState,
        draft: {
          lastTitle: nextTitle,
          lastUrl: nextUrl,
          lastWindowIdentityHashes: nextLastWindowIdentityHashes,
          lastTail: nextLastTail,
          incomingKeyOverlay,
        },
        changed,
        snapshot: {
          ...inputSnapshot,
          conversation: effectiveConversation,
          messages: changed ? Array.from(deltaByKey.values()) : [],
        },
        diff: { added, updated, removed: [] },
      });
    },
  };
}
