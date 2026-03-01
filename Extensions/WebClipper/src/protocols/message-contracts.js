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
    GET_SETTINGS: "obsidianGetSettings",
    SAVE_SETTINGS: "obsidianSaveSettings",
    TEST_CONNECTION: "obsidianTestConnection",
    SYNC_CONVERSATIONS: "obsidianSyncConversations",
    GET_SYNC_STATUS: "obsidianGetSyncStatus"
  });

  const ARTICLE_MESSAGE_TYPES = Object.freeze({
    FETCH_ACTIVE_TAB: "fetchActiveTabArticle"
  });

  const UI_MESSAGE_TYPES = Object.freeze({
    OPEN_EXTENSION_POPUP: "openExtensionPopup"
  });

  const UI_EVENT_TYPES = Object.freeze({
    CONVERSATIONS_CHANGED: "conversationsChanged"
  });

  const UI_PORT_NAMES = Object.freeze({
    POPUP_EVENTS: "popup:events"
  });

  const api = {
    CORE_MESSAGE_TYPES,
    NOTION_MESSAGE_TYPES,
    OBSIDIAN_MESSAGE_TYPES,
    ARTICLE_MESSAGE_TYPES,
    UI_MESSAGE_TYPES,
    UI_EVENT_TYPES,
    UI_PORT_NAMES
  };

  NS.messageContracts = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
