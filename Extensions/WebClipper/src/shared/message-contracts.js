/* global globalThis */

(function () {
  const NS = (globalThis.WebClipper = globalThis.WebClipper || {});

  const CORE_MESSAGE_TYPES = Object.freeze({
    UPSERT_CONVERSATION: "upsertConversation",
    SYNC_CONVERSATION_MESSAGES: "syncConversationMessages",
    GET_CONVERSATIONS: "getConversations",
    GET_CONVERSATION_DETAIL: "getConversationDetail",
    DELETE_CONVERSATIONS: "deleteConversations",
  });

  const NOTION_MESSAGE_TYPES = Object.freeze({
    GET_AUTH_STATUS: "getNotionAuthStatus",
    DISCONNECT: "notionDisconnect",
    SYNC_CONVERSATIONS: "notionSyncConversations",
    GET_SYNC_JOB_STATUS: "getNotionSyncJobStatus"
  });

  const OBSIDIAN_MESSAGE_TYPES = Object.freeze({
    OPEN_URL: "openObsidianUrl"
  });

  const api = {
    CORE_MESSAGE_TYPES,
    NOTION_MESSAGE_TYPES,
    OBSIDIAN_MESSAGE_TYPES
  };

  NS.messageContracts = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
