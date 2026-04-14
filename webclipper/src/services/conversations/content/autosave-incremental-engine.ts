import normalizeApi from '@services/shared/normalize.ts';
import {
  IDENTITY_PREFIX_LEN,
  computeRequiredOverlap,
  computeSuffixPrefixOverlap,
  getMessageIdentityBase,
  fingerprintHash,
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
  key: string;
  lastTitle: string;
  lastUrl: string;
  stateKeyHash: string;
  lastWindowIdentityHashes: string[];
  lastTail: TailEntry[];
  incomingKeyIdentities: Map<string, IncomingKeyIdentity>;
  initialized: boolean;
};

function normalizeMeta(value: unknown): string {
  return String(value || '').trim();
}

function computeStateKeyHash(stateKey: string): string {
  const normalize = normalizeApi as any;
  if (normalize && typeof normalize.fnv1a32 === 'function') return String(normalize.fnv1a32(stateKey));
  return stateKey.replace(/[^a-zA-Z0-9]+/g, '_');
}

export type AutoSaveIncrementalResult = {
  changed: boolean;
  snapshot: any;
  diff: Diff;
};

export type AutoSaveIncrementalEngine = {
  compute: (snapshot: any) => AutoSaveIncrementalResult;
  reset: () => void;
};

function makeConversationStateKey(snapshot: any): string {
  const source = normalizeMeta(snapshot?.conversation?.source);
  const conversationKey = normalizeMeta(snapshot?.conversation?.conversationKey);
  if (!source || !conversationKey) return '';
  return `${source}::${conversationKey}`;
}

function isPrefixOrFillingUpdate(prev: { text: string; markdown: string }, next: { text: string; markdown: string }) {
  const prevText = prev.text || '';
  const nextText = next.text || '';
  const prevMarkdown = prev.markdown || '';
  const nextMarkdown = next.markdown || '';

  const textFilled = !prevText && !!nextText;
  const markdownFilled = !prevMarkdown && !!nextMarkdown;

  const textGrew = !!(prevText && nextText && nextText.startsWith(prevText) && nextText.length > prevText.length);
  const markdownGrew = !!(
    prevMarkdown &&
    nextMarkdown &&
    nextMarkdown.startsWith(prevMarkdown) &&
    nextMarkdown.length > prevMarkdown.length
  );

  return {
    changed: prevText !== nextText || prevMarkdown !== nextMarkdown,
    acceptable: textFilled || markdownFilled || textGrew || markdownGrew,
  };
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

    const idx3 = tryPick((p) => {
      if (p.role !== cur.role) return false;
      const decision = isPrefixOrFillingUpdate(
        { text: p.text, markdown: p.markdown },
        { text: cur.text, markdown: cur.markdown },
      );
      return !decision.changed || decision.acceptable;
    });
    return idx3;
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

export function createAutoSaveIncrementalEngine(): AutoSaveIncrementalEngine {
  const byConversation = new Map<string, ConversationState>();
  const TAIL_UPDATE_WINDOW_SIZE = 2;
  const MAX_WINDOW_MESSAGES = 200;
  const SEED_MAX_MESSAGES = 6;

  function getOrCreateState(key: string): ConversationState {
    const existing = byConversation.get(key);
    if (existing) return existing;
    const next: ConversationState = {
      key,
      lastTitle: '',
      lastUrl: '',
      stateKeyHash: computeStateKeyHash(key),
      lastWindowIdentityHashes: [],
      lastTail: [],
      incomingKeyIdentities: new Map(),
      initialized: false,
    };
    byConversation.set(key, next);
    return next;
  }

  return {
    compute(snapshot: any): AutoSaveIncrementalResult {
      if (!snapshot || !snapshot.conversation)
        return { changed: false, snapshot: null, diff: { added: [], updated: [], removed: [] } };

      const stateKey = makeConversationStateKey(snapshot);
      if (!stateKey) {
        // Without a stable conversation identity, do not attempt to assign keys or diff.
        return { changed: false, snapshot: null, diff: { added: [], updated: [], removed: [] } };
      }

      const state = getOrCreateState(stateKey);

      if (state.initialized) {
        if (!normalizeMeta(snapshot.conversation.title) && state.lastTitle)
          snapshot.conversation.title = state.lastTitle;
        if (!normalizeMeta(snapshot.conversation.url) && state.lastUrl) snapshot.conversation.url = state.lastUrl;
      }

      const nextTitle = normalizeMeta(snapshot.conversation.title);
      const nextUrl = normalizeMeta(snapshot.conversation.url);
      const metaChanged = state.initialized && (nextTitle !== state.lastTitle || nextUrl !== state.lastUrl);

      const allMessages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
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

      for (const m of windowMessages) {
        const incomingKeyRaw = String(m?.messageKey || '').trim();
        const { role, base, text, markdown } = getMessageIdentityBase(m, IDENTITY_PREFIX_LEN);
        const identityHash = fingerprintHash(base);
        const fallbackIncomingKey = incomingKeyRaw.startsWith('fallback_');

        let stableIncomingKey = '';
        if (incomingKeyRaw && !fallbackIncomingKey) {
          const existing = state.incomingKeyIdentities.get(incomingKeyRaw);
          if (!existing) {
            state.incomingKeyIdentities.set(incomingKeyRaw, { role, text, markdown });
            stableIncomingKey = incomingKeyRaw;
          } else if (existing.role === role) {
            const decision = isPrefixOrFillingUpdate(existing, { text, markdown });
            if (decision.acceptable) {
              // Keep the latest content snapshot so future comparisons can still accept prefix growth.
              state.incomingKeyIdentities.set(incomingKeyRaw, { role, text, markdown });
              stableIncomingKey = incomingKeyRaw;
            } else {
              // Treat as unstable key reuse (virtualized lists may recycle index-based keys).
              stableIncomingKey = '';
            }
          } else {
            // Treat as unstable key reuse (virtualized lists may recycle index-based keys).
            stableIncomingKey = '';
          }
        }

        currentIdentityHashes.push(identityHash);
        currentComparable.push({ role, identityHash, text, markdown, stableIncomingKey });
      }

      // Session baseline: do not write on first capture (prevents massive duplication when re-entering a conversation).
      // autosave should only persist deltas; full history persistence remains manual Save's job.
      if (!state.initialized) {
        state.initialized = true;
        state.lastTitle = nextTitle;
        state.lastUrl = nextUrl;
        state.lastWindowIdentityHashes = currentIdentityHashes;
        state.lastTail = currentComparable
          .slice(Math.max(0, currentComparable.length - TAIL_UPDATE_WINDOW_SIZE))
          .map((m) => ({
            key: m.stableIncomingKey || '',
            role: m.role,
            identityHash: m.identityHash,
            text: m.text,
            markdown: m.markdown,
          }));

        // Seed: for short conversations, persist the initial window once so the first user/assistant messages don't get missed.
        // For long conversations, skip seeding to avoid huge writes on re-entry when collectors only expose a tail window.
        if (windowMessages.length > 0 && windowMessages.length <= SEED_MAX_MESSAGES) {
          const added: string[] = [];
          const addedSet = new Set<string>();
          const occurrenceByIdentity = new Map<string, number>();
          for (let i = 0; i < windowMessages.length; i += 1) {
            const msg = windowMessages[i];
            const meta = currentComparable[i];
            if (!msg || !meta) continue;

            const keyFromCollector = meta.stableIncomingKey;
            if (keyFromCollector) {
              msg.messageKey = keyFromCollector;
              if (!addedSet.has(keyFromCollector)) {
                addedSet.add(keyFromCollector);
                added.push(keyFromCollector);
              }
              continue;
            }

            const nextOcc = (occurrenceByIdentity.get(meta.identityHash) || 0) + 1;
            occurrenceByIdentity.set(meta.identityHash, nextOcc);
            const syntheticKey = `autosave_${state.stateKeyHash}_${meta.identityHash}_s${nextOcc}`;
            msg.messageKey = syntheticKey;
            if (!addedSet.has(syntheticKey)) {
              addedSet.add(syntheticKey);
              added.push(syntheticKey);
            }
          }

          snapshot.messages = windowMessages.filter(Boolean);
          // Keep tail keys in-sync with seeded messageKey assignments.
          const curTail = currentComparable.slice(Math.max(0, currentComparable.length - TAIL_UPDATE_WINDOW_SIZE));
          state.lastTail = curTail.map((m, idx) => {
            const msg = windowMessages[Math.max(0, windowMessages.length - curTail.length) + idx];
            const keyFromMsg = String(msg?.messageKey || '').trim();
            const key =
              m.stableIncomingKey || (keyFromMsg.startsWith(`autosave_${state.stateKeyHash}_`) ? keyFromMsg : '') || '';
            return { key, role: m.role, identityHash: m.identityHash, text: m.text, markdown: m.markdown };
          });

          return { changed: true, snapshot, diff: { added, updated: [], removed: [] } };
        }

        return { changed: false, snapshot: null, diff: { added: [], updated: [], removed: [] } };
      }

      const added: string[] = [];
      const updated: string[] = [];
      const addedSet = new Set<string>();
      const updatedSet = new Set<string>();

      const prevIdentityHashes = state.lastWindowIdentityHashes;
      const curLen = currentIdentityHashes.length;
      const prevLen = prevIdentityHashes.length;
      const requiredOverlap = computeRequiredOverlap(prevLen, curLen);
      const overlapLen = computeSuffixPrefixOverlap(prevIdentityHashes, currentIdentityHashes, requiredOverlap);

      const deltaByKey = new Map<string, any>();

      const pushDelta = (key: string, msg: any, kind: 'added' | 'updated') => {
        if (!key || !msg) return;
        if (!deltaByKey.has(key)) deltaByKey.set(key, msg);
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

      // 1) Tail prefix-growth / fill updates (N=2)
      const curTail = currentComparable.slice(Math.max(0, currentComparable.length - TAIL_UPDATE_WINDOW_SIZE));
      const prevTail = state.lastTail;
      for (let idx = 0; idx < curTail.length; idx += 1) {
        const prevEntry = prevTail[idx];
        const curEntry = curTail[idx];
        if (!prevEntry || !curEntry) continue;
        if (prevEntry.role !== curEntry.role) continue;

        const decision = isPrefixOrFillingUpdate(
          { text: prevEntry?.text || '', markdown: prevEntry?.markdown || '' },
          { text: curEntry.text, markdown: curEntry.markdown },
        );
        if (!decision.changed || !decision.acceptable) continue;

        const msgIndexFromEnd = curTail.length - 1 - idx;
        const key =
          curEntry.stableIncomingKey ||
          prevEntry?.key ||
          `autosave_${state.stateKeyHash}_${curEntry.identityHash}_tail${msgIndexFromEnd + 1}`;
        const msg = windowMessages[Math.max(0, windowMessages.length - curTail.length) + idx];
        if (msg) msg.messageKey = key;
        pushDelta(key, msg, prevEntry?.key ? 'updated' : 'added');
      }

      // 2) Appended new messages (only when we can confidently anchor to the previous window)
      if (prevLen === 0 || overlapLen > 0) {
        const appendStart = overlapLen;
        const appended = windowMessages.slice(appendStart);
        const appendedComparable = currentComparable.slice(appendStart);

        const occurrenceByIdentity = new Map<string, number>();
        for (let i = 0; i < appended.length; i += 1) {
          const msg = appended[i];
          const meta = appendedComparable[i];
          if (!msg || !meta) continue;

          const keyFromCollector = meta.stableIncomingKey;
          if (keyFromCollector) {
            msg.messageKey = keyFromCollector;
            pushDelta(keyFromCollector, msg, 'added');
            continue;
          }

          const nextOcc = (occurrenceByIdentity.get(meta.identityHash) || 0) + 1;
          occurrenceByIdentity.set(meta.identityHash, nextOcc);
          const syntheticKey = `autosave_${state.stateKeyHash}_${meta.identityHash}_a${nextOcc}`;
          msg.messageKey = syntheticKey;
          pushDelta(syntheticKey, msg, 'added');
        }
      }

      // If we couldn't anchor reliably, don't write message deltas (avoids duplicate blow-ups on re-entry / virtualized renders).
      const changed = metaChanged || added.length > 0 || updated.length > 0;
      if (!changed) {
        state.lastTitle = nextTitle;
        state.lastUrl = nextUrl;
        state.lastWindowIdentityHashes = currentIdentityHashes;
        const tailWindowMessages = windowMessages.slice(Math.max(0, windowMessages.length - curTail.length));
        state.lastTail = buildTailEntries({
          prevTail,
          curTail,
          tailWindowMessages,
          stateKeyHash: state.stateKeyHash,
        });
        return { changed: false, snapshot: null, diff: { added: [], updated: [], removed: [] } };
      }

      snapshot.messages = Array.from(deltaByKey.values());

      state.lastTitle = nextTitle;
      state.lastUrl = nextUrl;
      state.lastWindowIdentityHashes = currentIdentityHashes;
      const tailWindowMessages = windowMessages.slice(Math.max(0, windowMessages.length - curTail.length));
      state.lastTail = buildTailEntries({
        prevTail,
        curTail,
        tailWindowMessages,
        stateKeyHash: state.stateKeyHash,
      });

      return { changed: true, snapshot, diff: { added, updated, removed: [] } };
    },

    reset() {
      byConversation.clear();
    },
  };
}
