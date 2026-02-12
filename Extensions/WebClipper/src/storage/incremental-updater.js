(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const state = {
    lastConversationKey: "",
    lastMessageKeys: []
  };

  function computeMessageKeys(messages) {
    return (messages || []).map((m) => m && m.messageKey).filter(Boolean);
  }

  function computeIncremental(snapshot) {
    if (!snapshot || !snapshot.conversation) return { changed: false, snapshot: null };
    const conversationKey = snapshot.conversation.conversationKey || "";
    const messageKeys = computeMessageKeys(snapshot.messages);

    const changed =
      conversationKey !== state.lastConversationKey ||
      messageKeys.length !== state.lastMessageKeys.length ||
      messageKeys.some((k, i) => k !== state.lastMessageKeys[i]);

    if (changed) {
      state.lastConversationKey = conversationKey;
      state.lastMessageKeys = messageKeys;
    }

    return { changed, snapshot };
  }

  function __resetForTests() {
    state.lastConversationKey = "";
    state.lastMessageKeys = [];
  }

  const api = { computeIncremental, __resetForTests };
  NS.incrementalUpdater = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
