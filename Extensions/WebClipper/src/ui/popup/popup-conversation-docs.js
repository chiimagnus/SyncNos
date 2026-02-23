(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});
  const core = NS.popupCore;
  if (!core) return;

  const { state, send, conversationToMarkdown } = core;
  const contracts = NS.messageContracts || {};
  const coreTypes = contracts.CORE_MESSAGE_TYPES || {
    GET_CONVERSATION_DETAIL: "getConversationDetail"
  };

  function normalizeSelectedIds(selectedIds) {
    return Array.from(new Set(
      Array.isArray(selectedIds)
        ? selectedIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
        : []
    ));
  }

  function selectedConversationsByIds(selectedIds) {
    const idSet = new Set(normalizeSelectedIds(selectedIds));
    const all = Array.isArray(state && state.conversations) ? state.conversations : [];
    return all.filter((c) => c && idSet.has(Number(c.id)));
  }

  async function getMessagesForConversation(conversation) {
    if (!conversation || !conversation.id) throw new Error("Invalid conversation.");
    const detail = await send(coreTypes.GET_CONVERSATION_DETAIL, { conversationId: conversation.id });
    if (!detail || !detail.ok) {
      throw new Error((detail && detail.error && detail.error.message) || `Failed to load conversation#${conversation.id}`);
    }
    return (detail && detail.data && Array.isArray(detail.data.messages)) ? detail.data.messages : [];
  }

  async function buildConversationDocs({ selectedIds, throwOnEmpty } = {}) {
    const selected = selectedConversationsByIds(selectedIds);
    if (!selected.length) {
      if (throwOnEmpty === false) return [];
      throw new Error("No conversations selected.");
    }

    const docs = [];
    for (const conversation of selected) {
      // eslint-disable-next-line no-await-in-loop
      const messages = await getMessagesForConversation(conversation);
      docs.push({
        conversation,
        messages,
        markdown: conversationToMarkdown({ conversation, messages })
      });
    }
    return docs;
  }

  NS.popupConversationDocs = {
    buildConversationDocs,
    normalizeSelectedIds,
    selectedConversationsByIds
  };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.popupConversationDocs;
})();
