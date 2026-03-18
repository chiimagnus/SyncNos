import normalizeApi from '../../shared/normalize.ts';

type Diff = { added: string[]; updated: string[]; removed: string[] };

type ConversationState = {
  key: string;
  lastTitle: string;
  lastUrl: string;
  // All keys ever seen for this conversation. Must be append-only to prevent key reuse overwriting history.
  keyToFingerprint: Map<string, string>;
  // fingerprint -> stable key per occurrence index in the current visible snapshot.
  fingerprintToKeys: Map<string, string[]>;
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

function makeKey(hash: string, occurrenceIndex: number, disambiguator: number) {
  const suffix = disambiguator > 0 ? `_${disambiguator}` : '';
  return `autosave_${hash}_${occurrenceIndex}${suffix}`;
}

function pickOrCreateStableKey(state: ConversationState, fp: string, occurrenceIndex: number, incomingKey: string): string {
  const existingList = state.fingerprintToKeys.get(fp) || [];
  const stable = existingList[occurrenceIndex];

  const incoming = String(incomingKey || '').trim();
  const incomingFp = incoming ? state.keyToFingerprint.get(incoming) : null;
  const incomingIsValid = !!(incoming && (!incomingFp || incomingFp === fp));

  if (incomingIsValid) {
    // Prefer the collector-provided key when it does not conflict with previously observed content.
    // This keeps stable IDs stable, while still preventing overwrites when the collector reuses keys for different messages.
    if (stable !== incoming) {
      existingList[occurrenceIndex] = incoming;
      state.fingerprintToKeys.set(fp, existingList);
    }
    return incoming;
  }

  if (stable) {
    return stable;
  }

  let disambiguator = 0;
  while (true) {
    const candidate = makeKey(fp, occurrenceIndex, disambiguator);
    const prev = state.keyToFingerprint.get(candidate);
    if (!prev || prev === fp) {
      existingList[occurrenceIndex] = candidate;
      state.fingerprintToKeys.set(fp, existingList);
      return candidate;
    }
    disambiguator += 1;
  }
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

  function getOrCreateState(key: string): ConversationState {
    const existing = byConversation.get(key);
    if (existing) return existing;
    const next: ConversationState = {
      key,
      lastTitle: '',
      lastUrl: '',
      keyToFingerprint: new Map(),
      fingerprintToKeys: new Map(),
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
      const perFingerprintOccurrence = new Map<string, number>();

      const added: string[] = [];
      const updated: string[] = [];

      for (const message of messages) {
        if (!message) continue;

        const incomingKey = message && message.messageKey ? String(message.messageKey) : '';
        const { base } = fingerprintBase(message);
        const fp = fingerprintHash(base);

        const occurrenceIndex = perFingerprintOccurrence.get(fp) || 0;
        perFingerprintOccurrence.set(fp, occurrenceIndex + 1);

        const key = pickOrCreateStableKey(state, fp, occurrenceIndex, incomingKey);
        message.messageKey = key;

        const prevFp = state.keyToFingerprint.get(key);
        if (!prevFp) added.push(key);
        else if (prevFp !== fp) updated.push(key);

        // Append-only: never delete old keys; keep all known key -> fingerprint mappings forever.
        state.keyToFingerprint.set(key, fp);
      }

      const changed = !state.initialized || metaChanged || added.length > 0 || updated.length > 0;

      state.initialized = true;
      state.lastTitle = nextTitle;
      state.lastUrl = nextUrl;

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
