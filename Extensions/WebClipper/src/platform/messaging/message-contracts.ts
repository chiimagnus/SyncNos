export const CORE_MESSAGE_TYPES = {
  UPSERT_CONVERSATION: 'upsertConversation',
  SYNC_CONVERSATION_MESSAGES: 'syncConversationMessages',
  GET_CONVERSATIONS: 'getConversations',
  GET_CONVERSATION_DETAIL: 'getConversationDetail',
  DELETE_CONVERSATIONS: 'deleteConversations',
} as const;

export const NOTION_MESSAGE_TYPES = {
  GET_AUTH_STATUS: 'getNotionAuthStatus',
  DISCONNECT: 'notionDisconnect',
  SYNC_CONVERSATIONS: 'notionSyncConversations',
  GET_SYNC_JOB_STATUS: 'getNotionSyncJobStatus',
  CLEAR_SYNC_JOB_STATUS: 'clearNotionSyncJobStatus',
} as const;

export const OBSIDIAN_MESSAGE_TYPES = {
  GET_SETTINGS: 'obsidianGetSettings',
  SAVE_SETTINGS: 'obsidianSaveSettings',
  TEST_CONNECTION: 'obsidianTestConnection',
  SYNC_CONVERSATIONS: 'obsidianSyncConversations',
  GET_SYNC_STATUS: 'obsidianGetSyncStatus',
  CLEAR_SYNC_STATUS: 'clearObsidianSyncStatus',
} as const;

export const ARTICLE_MESSAGE_TYPES = {
  FETCH_ACTIVE_TAB: 'fetchActiveTabArticle',
} as const;

export const UI_MESSAGE_TYPES = {
  OPEN_EXTENSION_POPUP: 'openExtensionPopup',
} as const;

export const UI_EVENT_TYPES = {
  CONVERSATIONS_CHANGED: 'conversationsChanged',
} as const;

export const UI_PORT_NAMES = {
  POPUP_EVENTS: 'popup:events',
} as const;

export const messageContracts = {
  CORE_MESSAGE_TYPES,
  NOTION_MESSAGE_TYPES,
  OBSIDIAN_MESSAGE_TYPES,
  ARTICLE_MESSAGE_TYPES,
  UI_MESSAGE_TYPES,
  UI_EVENT_TYPES,
  UI_PORT_NAMES,
} as const;

export type CoreMessageType = (typeof CORE_MESSAGE_TYPES)[keyof typeof CORE_MESSAGE_TYPES];
export type NotionMessageType = (typeof NOTION_MESSAGE_TYPES)[keyof typeof NOTION_MESSAGE_TYPES];
export type ObsidianMessageType = (typeof OBSIDIAN_MESSAGE_TYPES)[keyof typeof OBSIDIAN_MESSAGE_TYPES];
export type ArticleMessageType = (typeof ARTICLE_MESSAGE_TYPES)[keyof typeof ARTICLE_MESSAGE_TYPES];
export type UiMessageType = (typeof UI_MESSAGE_TYPES)[keyof typeof UI_MESSAGE_TYPES];
export type UiEventType = (typeof UI_EVENT_TYPES)[keyof typeof UI_EVENT_TYPES];
export type UiPortName = (typeof UI_PORT_NAMES)[keyof typeof UI_PORT_NAMES];

export type MessageType =
  | CoreMessageType
  | NotionMessageType
  | ObsidianMessageType
  | ArticleMessageType
  | UiMessageType;
