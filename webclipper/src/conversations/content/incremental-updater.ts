import normalizeApi from '../../shared/normalize.ts';

const state = {
  lastConversationKey: '',
  lastConversationTitle: '',
  lastConversationUrl: '',
  lastMessageKeys: [] as string[],
  lastMessageFingerprints: new Map<string, string>(),
};

function makeStableAutoSaveMessageKey(message: any, sequence: number): string {
  const normalize = normalizeApi;
  const role = (message && message.role) || 'assistant';
  const base = `${role}|${sequence || 0}`;
  const hash =
    normalize && typeof normalize.fnv1a32 === 'function'
      ? normalize.fnv1a32(base)
      : base;
  return `autosave_${hash}`;
}

function messageFingerprint(message: any, sequence: number, key: string) {
  const normalize = normalizeApi;
  const role = (message && message.role) || 'assistant';
  const text =
    normalize && typeof normalize.normalizeText === 'function'
      ? normalize.normalizeText(message && message.contentText)
      : String((message && message.contentText) || '');
  const markdownRaw =
    message && message.contentMarkdown && String(message.contentMarkdown).trim()
      ? String(message.contentMarkdown)
      : '';
  const markdown =
    normalize && typeof normalize.normalizeText === 'function'
      ? normalize.normalizeText(markdownRaw)
      : markdownRaw;
  const hashBase = markdown ? `${role}|${text}|md:${markdown}` : `${role}|${text}`;
  const hash =
    normalize && typeof normalize.fnv1a32 === 'function'
      ? normalize.fnv1a32(hashBase)
      : hashBase;
  return { key, fp: `${key}:${hash}` };
}

function normalizeMeta(value: unknown): string {
  return String(value || '').trim();
}

export function computeIncremental(snapshot: any) {
  if (!snapshot || !snapshot.conversation) return { changed: false, snapshot: null };
  const conversationKey = snapshot.conversation.conversationKey || '';
  const incomingTitle = normalizeMeta(snapshot.conversation.title);
  const incomingUrl = normalizeMeta(snapshot.conversation.url);

  if (conversationKey && conversationKey === state.lastConversationKey) {
    if (!incomingTitle && state.lastConversationTitle) {
      snapshot.conversation.title = state.lastConversationTitle;
    }
    if (!incomingUrl && state.lastConversationUrl) {
      snapshot.conversation.url = state.lastConversationUrl;
    }
  }

  const nextTitle = normalizeMeta(snapshot.conversation.title);
  const nextUrl = normalizeMeta(snapshot.conversation.url);

  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  const nextKeys: string[] = [];
  const nextFingerprints = new Map<string, string>();
  const usedKeys = new Set<string>();
  const added: string[] = [];
  const updated: string[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;

    let key = message && message.messageKey ? String(message.messageKey) : '';
    if (!key && conversationKey && conversationKey === state.lastConversationKey) {
      const candidate = state.lastMessageKeys[index] ? String(state.lastMessageKeys[index]) : '';
      if (candidate && !usedKeys.has(candidate)) key = candidate;
    }
    if (!key) key = makeStableAutoSaveMessageKey(message, index);
    usedKeys.add(key);
    message.messageKey = key;

    const { fp } = messageFingerprint(message, index, key);
    nextKeys.push(key);
    nextFingerprints.set(key, fp);

    const previousFingerprint = state.lastMessageFingerprints.get(key);
    if (!previousFingerprint) added.push(key);
    else if (previousFingerprint !== fp) updated.push(key);
  }

  const removed: string[] = [];
  for (const previousKey of state.lastMessageKeys) {
    if (!nextFingerprints.has(previousKey)) removed.push(previousKey);
  }

  const metaChanged =
    conversationKey === state.lastConversationKey &&
    (nextTitle !== state.lastConversationTitle || nextUrl !== state.lastConversationUrl);
  const changed =
    conversationKey !== state.lastConversationKey ||
    metaChanged ||
    added.length > 0 ||
    updated.length > 0 ||
    removed.length > 0;

  if (changed) {
    state.lastConversationKey = conversationKey;
    state.lastConversationTitle = nextTitle;
    state.lastConversationUrl = nextUrl;
    state.lastMessageKeys = nextKeys;
    state.lastMessageFingerprints = nextFingerprints;
  }

  return {
    changed,
    snapshot,
    diff: { added, updated, removed },
  };
}

export function __resetForTests() {
  state.lastConversationKey = '';
  state.lastConversationTitle = '';
  state.lastConversationUrl = '';
  state.lastMessageKeys = [];
  state.lastMessageFingerprints = new Map<string, string>();
}

const incrementalUpdaterApi = {
  computeIncremental,
  __resetForTests,
};

export default incrementalUpdaterApi;
