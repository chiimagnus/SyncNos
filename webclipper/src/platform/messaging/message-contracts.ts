export const CORE_MESSAGE_TYPES = {
  UPSERT_CONVERSATION: 'upsertConversation',
  MERGE_CONVERSATIONS: 'mergeConversations',
  SYNC_CONVERSATION_MESSAGES: 'syncConversationMessages',
  BACKFILL_CONVERSATION_IMAGES: 'backfillConversationImages',
  GET_CONVERSATION_LIST_BOOTSTRAP: 'getConversationListBootstrap',
  GET_CONVERSATION_LIST_PAGE: 'getConversationListPage',
  FIND_CONVERSATION_BY_SOURCE_AND_KEY: 'findConversationBySourceAndKey',
  FIND_CONVERSATION_BY_ID: 'findConversationById',
  GET_CONVERSATION_DETAIL: 'getConversationDetail',
  GET_CONVERSATION_TAIL_WINDOW_BY_SOURCE_AND_KEY: 'getConversationTailWindowBySourceAndKey',
  DELETE_CONVERSATIONS: 'deleteConversations',
} as const;

export const NOTION_MESSAGE_TYPES = {
  GET_AUTH_STATUS: 'getNotionAuthStatus',
  DISCONNECT: 'notionDisconnect',
  LIST_PARENT_PAGES: 'listNotionParentPages',
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
  RESOLVE_OR_CAPTURE_ACTIVE_TAB: 'resolveOrCaptureActiveTabArticle',
} as const;

export const CHATGPT_MESSAGE_TYPES = {
  EXTRACT_DEEP_RESEARCH: 'chatgptExtractDeepResearch',
} as const;

export const CURRENT_PAGE_MESSAGE_TYPES = {
  GET_CAPTURE_STATE: 'getCurrentPageCaptureState',
  CAPTURE: 'captureCurrentPage',
} as const;

export const ITEM_MENTION_MESSAGE_TYPES = {
  SEARCH_MENTION_CANDIDATES: 'searchMentionCandidates',
  BUILD_MENTION_INSERT_TEXT: 'buildMentionInsertText',
} as const;

export const CHATWITH_MESSAGE_TYPES = {
  OPEN_PLATFORM_TAB: 'chatwithOpenPlatformTab',
  OPEN_OR_FOCUS_GROUPED_CHAT_TAB: 'chatwithOpenOrFocusGroupedChatTab',
} as const;

// Messages sent to content scripts (not handled by background router).
export const CONTENT_MESSAGE_TYPES = {
  OPEN_INPAGE_COMMENTS_PANEL: 'openInpageCommentsPanel',
  EXTRACT_WEB_ARTICLE: 'extractWebArticle',
  CAPTURE_VIDEO_TRANSCRIPT: 'captureVideoTranscript',
} as const;

export const COMMENTS_MESSAGE_TYPES = {
  LIST_ARTICLE_COMMENTS: 'listArticleComments',
  ADD_ARTICLE_COMMENT: 'addArticleComment',
  DELETE_ARTICLE_COMMENT: 'deleteArticleComment',
  ATTACH_ORPHAN_ARTICLE_COMMENTS: 'attachOrphanArticleComments',
  MIGRATE_ARTICLE_COMMENTS_CANONICAL_URL: 'migrateArticleCommentsCanonicalUrl',
} as const;

export const UI_MESSAGE_TYPES = {
  OPEN_EXTENSION_POPUP: 'openExtensionPopup',
  OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL: 'openCurrentTabInpageCommentsPanel',
  GET_ACTIVE_TAB_CAPTURE_STATE: 'getActiveTabCaptureState',
  CAPTURE_ACTIVE_TAB_CURRENT_PAGE: 'captureActiveTabCurrentPage',
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
  CHATGPT_MESSAGE_TYPES,
  CURRENT_PAGE_MESSAGE_TYPES,
  ITEM_MENTION_MESSAGE_TYPES,
  CHATWITH_MESSAGE_TYPES,
  COMMENTS_MESSAGE_TYPES,
  UI_MESSAGE_TYPES,
  UI_EVENT_TYPES,
  UI_PORT_NAMES,
} as const;

export type CoreMessageType = (typeof CORE_MESSAGE_TYPES)[keyof typeof CORE_MESSAGE_TYPES];
export type NotionMessageType = (typeof NOTION_MESSAGE_TYPES)[keyof typeof NOTION_MESSAGE_TYPES];
export type ObsidianMessageType = (typeof OBSIDIAN_MESSAGE_TYPES)[keyof typeof OBSIDIAN_MESSAGE_TYPES];
export type ArticleMessageType = (typeof ARTICLE_MESSAGE_TYPES)[keyof typeof ARTICLE_MESSAGE_TYPES];
export type ChatgptMessageType = (typeof CHATGPT_MESSAGE_TYPES)[keyof typeof CHATGPT_MESSAGE_TYPES];
export type CurrentPageMessageType = (typeof CURRENT_PAGE_MESSAGE_TYPES)[keyof typeof CURRENT_PAGE_MESSAGE_TYPES];
export type ItemMentionMessageType = (typeof ITEM_MENTION_MESSAGE_TYPES)[keyof typeof ITEM_MENTION_MESSAGE_TYPES];
export type ChatWithMessageType = (typeof CHATWITH_MESSAGE_TYPES)[keyof typeof CHATWITH_MESSAGE_TYPES];
export type CommentsMessageType = (typeof COMMENTS_MESSAGE_TYPES)[keyof typeof COMMENTS_MESSAGE_TYPES];
export type UiMessageType = (typeof UI_MESSAGE_TYPES)[keyof typeof UI_MESSAGE_TYPES];
export type UiEventType = (typeof UI_EVENT_TYPES)[keyof typeof UI_EVENT_TYPES];
export type UiPortName = (typeof UI_PORT_NAMES)[keyof typeof UI_PORT_NAMES];

export type MessageType =
  | CoreMessageType
  | NotionMessageType
  | ObsidianMessageType
  | ArticleMessageType
  | ChatgptMessageType
  | CurrentPageMessageType
  | ItemMentionMessageType
  | ChatWithMessageType
  | CommentsMessageType
  | UiMessageType;
