(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const state = {
    lastConversationKey: "",
    lastConversationTitle: "",
    lastConversationUrl: "",
    lastMessageKeys: [],
    lastMessageFingerprints: new Map()
  };

  function normalizeModule() {
    return NS.normalize || {};
  }

  function ensureMessageKey(m, sequence) {
    if (m && m.messageKey) return m.messageKey;
    const n = normalizeModule();
    if (n && typeof n.makeFallbackMessageKey === "function") {
      return n.makeFallbackMessageKey({ role: m && m.role, contentText: m && m.contentText, sequence });
    }
    return `fallback_${sequence || 0}`;
  }

  function messageFingerprint(m, sequence) {
    const n = normalizeModule();
    const role = (m && m.role) || "assistant";
    const text = (n && typeof n.normalizeText === "function") ? n.normalizeText(m && m.contentText) : String(m && m.contentText || "");
    const hash = (n && typeof n.fnv1a32 === "function") ? n.fnv1a32(`${role}|${text}`) : `${role}|${text}`;
    const key = ensureMessageKey(m, sequence);
    return { key, fp: `${key}:${hash}` };
  }

  function normalizeMeta(value) {
    return String(value || "").trim();
  }

  function computeIncremental(snapshot) {
    if (!snapshot || !snapshot.conversation) return { changed: false, snapshot: null };
    const conversationKey = snapshot.conversation.conversationKey || "";
    const incomingTitle = normalizeMeta(snapshot.conversation.title);
    const incomingUrl = normalizeMeta(snapshot.conversation.url);

    // Avoid propagating empty meta values which can flicker when DOM isn't ready.
    if (conversationKey && conversationKey === state.lastConversationKey) {
      if (!incomingTitle && state.lastConversationTitle) snapshot.conversation.title = state.lastConversationTitle;
      if (!incomingUrl && state.lastConversationUrl) snapshot.conversation.url = state.lastConversationUrl;
    }

    const nextTitle = normalizeMeta(snapshot.conversation.title);
    const nextUrl = normalizeMeta(snapshot.conversation.url);

    const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    const nextKeys = [];
    const nextFps = new Map();
    const added = [];
    const updated = [];

    for (let i = 0; i < messages.length; i += 1) {
      const m = messages[i];
      if (!m) continue;
      const { key, fp } = messageFingerprint(m, i);
      m.messageKey = key;
      nextKeys.push(key);
      nextFps.set(key, fp);

      const prevFp = state.lastMessageFingerprints.get(key);
      if (!prevFp) added.push(key);
      else if (prevFp !== fp) updated.push(key);
    }

    const removed = [];
    for (const prevKey of state.lastMessageKeys) {
      if (!nextFps.has(prevKey)) removed.push(prevKey);
    }

    const metaChanged = (
      conversationKey === state.lastConversationKey
      && (nextTitle !== state.lastConversationTitle || nextUrl !== state.lastConversationUrl)
    );
    const changed = conversationKey !== state.lastConversationKey || metaChanged || added.length > 0 || updated.length > 0 || removed.length > 0;

    if (changed) {
      state.lastConversationKey = conversationKey;
      state.lastConversationTitle = nextTitle;
      state.lastConversationUrl = nextUrl;
      state.lastMessageKeys = nextKeys;
      state.lastMessageFingerprints = nextFps;
    }

    return {
      changed,
      snapshot,
      diff: { added, updated, removed }
    };
  }

  function __resetForTests() {
    state.lastConversationKey = "";
    state.lastConversationTitle = "";
    state.lastConversationUrl = "";
    state.lastMessageKeys = [];
    state.lastMessageFingerprints = new Map();
  }

  const api = { computeIncremental, __resetForTests };
  NS.incrementalUpdater = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
