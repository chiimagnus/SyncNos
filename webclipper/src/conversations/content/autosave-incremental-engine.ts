import normalizeApi from '../../shared/normalize.ts';

type Diff = { added: string[]; updated: string[]; removed: string[] };

type ConversationState = {
  key: string;
  lastTitle: string;
  lastUrl: string;
  stateKeyHash: string;
  captureSeq: number;
  lastVisibleFingerprints: string[];
  lastVisibleKeys: string[];
  lastTail: Array<{ key: string; role: string; text: string; markdown: string }>;
  initialized: boolean;
};

function normalizeMeta(value: unknown): string {
  return String(value || '').trim();
}

function normalizeContent(value: unknown): string {
  const normalize = normalizeApi as any;
  if (normalize && typeof normalize.normalizeText === 'function') {
    return normalize.normalizeText(value);
  }
  return String(value || '');
}

function fingerprintBase(message: any): { role: string; base: string } {
  const role = String((message && message.role) || 'assistant').trim() || 'assistant';
  const text = normalizeContent(message && message.contentText);
  const markdownRaw = message && message.contentMarkdown && String(message.contentMarkdown).trim() ? String(message.contentMarkdown) : '';
  const markdown = markdownRaw ? normalizeContent(markdownRaw) : '';
  const base = markdown ? `${role}|${text}|md:${markdown}` : `${role}|${text}`;
  return { role, base };
}

function fingerprintHash(base: string): string {
  const normalize = normalizeApi as any;
  if (normalize && typeof normalize.fnv1a32 === 'function') return String(normalize.fnv1a32(base));
  return base;
}

function arrayEqual(a: string[], b: string[]) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function makeAutoSaveMessageKey(state: ConversationState, messageIndex: number) {
  return `autosave_${state.stateKeyHash}_${state.captureSeq}_${messageIndex}`;
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

export function createAutoSaveIncrementalEngine(): AutoSaveIncrementalEngine {
  const byConversation = new Map<string, ConversationState>();
  const TAIL_UPDATE_WINDOW_SIZE = 2;

  function getOrCreateState(key: string): ConversationState {
    const existing = byConversation.get(key);
    if (existing) return existing;
    const next: ConversationState = {
      key,
      lastTitle: '',
      lastUrl: '',
      stateKeyHash: computeStateKeyHash(key),
      captureSeq: 0,
      lastVisibleFingerprints: [],
      lastVisibleKeys: [],
      lastTail: [],
      initialized: false,
    };
    byConversation.set(key, next);
    return next;
  }

  return {
    compute(snapshot: any): AutoSaveIncrementalResult {
      if (!snapshot || !snapshot.conversation) return { changed: false, snapshot: null, diff: { added: [], updated: [], removed: [] } };

      const stateKey = makeConversationStateKey(snapshot);
      if (!stateKey) {
        // Without a stable conversation identity, do not attempt to assign keys or diff.
        return { changed: false, snapshot: null, diff: { added: [], updated: [], removed: [] } };
      }

      const state = getOrCreateState(stateKey);

      if (state.initialized) {
        if (!normalizeMeta(snapshot.conversation.title) && state.lastTitle) snapshot.conversation.title = state.lastTitle;
        if (!normalizeMeta(snapshot.conversation.url) && state.lastUrl) snapshot.conversation.url = state.lastUrl;
      }

      const nextTitle = normalizeMeta(snapshot.conversation.title);
      const nextUrl = normalizeMeta(snapshot.conversation.url);
      const metaChanged = state.initialized && (nextTitle !== state.lastTitle || nextUrl !== state.lastUrl);

      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const currentFingerprints = messages.map((m: any) => {
        const { base } = fingerprintBase(m);
        return fingerprintHash(base);
      });

      if (state.initialized && arrayEqual(currentFingerprints, state.lastVisibleFingerprints)) {
        if (!metaChanged) return { changed: false, snapshot: null, diff: { added: [], updated: [], removed: [] } };
        state.lastTitle = nextTitle;
        state.lastUrl = nextUrl;
        snapshot.messages = [];
        return { changed: true, snapshot, diff: { added: [], updated: [], removed: [] } };
      }

      const added: string[] = [];
      const updated: string[] = [];

      state.captureSeq += 1;

      const prevLen = state.lastVisibleFingerprints.length;
      const curLen = currentFingerprints.length;
      const lengthSame = state.initialized && curLen === prevLen;
      const stablePrefixLen = Math.max(0, curLen - TAIL_UPDATE_WINDOW_SIZE);
      const prefixStable =
        lengthSame &&
        arrayEqual(
          currentFingerprints.slice(0, stablePrefixLen),
          state.lastVisibleFingerprints.slice(0, stablePrefixLen),
        );
      const appendAtEnd =
        state.initialized &&
        curLen === prevLen + 1 &&
        arrayEqual(currentFingerprints.slice(0, prevLen), state.lastVisibleFingerprints);

      const tailStartIndex = Math.max(0, curLen - TAIL_UPDATE_WINDOW_SIZE);
      const allowTailUpdates = prefixStable && state.lastTail.length === Math.min(TAIL_UPDATE_WINDOW_SIZE, curLen);

      const nextKeys: string[] = [];

      for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
        const message = messages[messageIndex];
        if (!message) continue;

        const fp = currentFingerprints[messageIndex] || '';
        let key = '';

        if (appendAtEnd && messageIndex < prevLen) {
          key = String(state.lastVisibleKeys[messageIndex] || '');
        } else if (prefixStable && messageIndex < stablePrefixLen) {
          key = String(state.lastVisibleKeys[messageIndex] || '');
        } else if (prefixStable && messageIndex >= tailStartIndex) {
          // Tail window: allow exact-match reuse or prefix-growth update.
          const prevFp = String(state.lastVisibleFingerprints[messageIndex] || '');
          const prevKey = String(state.lastVisibleKeys[messageIndex] || '');
          if (prevKey && prevFp && prevFp === fp) {
            key = prevKey;
          } else if (allowTailUpdates) {
            const tailIndex = messageIndex - tailStartIndex;
            const prev = state.lastTail[tailIndex];
            if (prev && prev.key) {
              const role = String((message && message.role) || 'assistant').trim() || 'assistant';
              if (prev.role === role) {
                const text = normalizeContent(message && message.contentText);
                const markdownRaw =
                  message && message.contentMarkdown && String(message.contentMarkdown).trim()
                    ? String(message.contentMarkdown)
                    : '';
                const markdown = markdownRaw ? normalizeContent(markdownRaw) : '';

                const textGrew = !!(prev.text && text && text.startsWith(prev.text) && text.length > prev.text.length);
                const markdownGrew = !!(
                  prev.markdown &&
                  markdown &&
                  markdown.startsWith(prev.markdown) &&
                  markdown.length > prev.markdown.length
                );
                if (textGrew || markdownGrew) {
                  key = prev.key;
                  updated.push(key);
                }
              }
            }
          }
        }

        if (!key) {
          key = makeAutoSaveMessageKey(state, messageIndex);
          added.push(key);
        }

        message.messageKey = key;
        nextKeys[messageIndex] = key;
      }

      const changed = !state.initialized || metaChanged || added.length > 0 || updated.length > 0;

      state.initialized = true;
      state.lastTitle = nextTitle;
      state.lastUrl = nextUrl;
      state.lastVisibleFingerprints = currentFingerprints;
      state.lastVisibleKeys = nextKeys;
      const nextTail = messages
        .slice(Math.max(0, messages.length - TAIL_UPDATE_WINDOW_SIZE))
        .map((m: any) => ({
          key: String(m?.messageKey || ''),
          role: String((m && m.role) || 'assistant').trim() || 'assistant',
          text: normalizeContent(m && m.contentText),
          markdown: normalizeContent(m && m.contentMarkdown),
        }))
        .filter((x: any) => x && x.key);
      state.lastTail = nextTail;

      return {
        changed,
        snapshot,
        diff: { added, updated, removed: [] },
      };
    },

    reset() {
      byConversation.clear();
    },
  };
}
