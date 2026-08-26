export type AutoSyncProviderId = 'notion' | 'obsidian' | 'feishu' | 'github';

export const NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY = 'notion_auto_sync_enabled_v1' as const;
export const OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY = 'obsidian_auto_sync_enabled_v1' as const;
export const FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY = 'feishu_auto_sync_enabled_v1' as const;
export const GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY = 'github_auto_sync_enabled_v1' as const;

export function autoSyncEnabledStorageKey(provider: AutoSyncProviderId) {
  switch (provider) {
    case 'notion':
      return NOTION_AUTO_SYNC_ENABLED_STORAGE_KEY;
    case 'obsidian':
      return OBSIDIAN_AUTO_SYNC_ENABLED_STORAGE_KEY;
    case 'feishu':
      return FEISHU_AUTO_SYNC_ENABLED_STORAGE_KEY;
    case 'github':
      return GITHUB_AUTO_SYNC_ENABLED_STORAGE_KEY;
  }
}

export const NOTION_AUTO_SYNC_DEBOUNCE_ALARM_NAME = 'auto_sync_notion_debounce_v1' as const;
export const OBSIDIAN_AUTO_SYNC_DEBOUNCE_ALARM_NAME = 'auto_sync_obsidian_debounce_v1' as const;
export const FEISHU_AUTO_SYNC_DEBOUNCE_ALARM_NAME = 'auto_sync_feishu_debounce_v1' as const;
export const GITHUB_AUTO_SYNC_DEBOUNCE_ALARM_NAME = 'auto_sync_github_debounce_v1' as const;
export const GITHUB_AUTO_SYNC_CLEANUP_ALARM_NAME = 'auto_sync_github_cleanup_v1' as const;

export const NOTION_AUTO_SYNC_QUEUE_STORAGE_KEY = 'notion_auto_sync_queue_v1' as const;
export const NOTION_AUTO_SYNC_DEBOUNCE_MS = 60_000;
export const NOTION_AUTO_SYNC_QUEUE_MAX_ITEMS = 200;

export const OBSIDIAN_AUTO_SYNC_QUEUE_STORAGE_KEY = 'obsidian_auto_sync_queue_v1' as const;
export const OBSIDIAN_AUTO_SYNC_DEBOUNCE_MS = 60_000;
export const OBSIDIAN_AUTO_SYNC_QUEUE_MAX_ITEMS = 200;

export const FEISHU_AUTO_SYNC_QUEUE_STORAGE_KEY = 'feishu_auto_sync_queue_v1' as const;
export const FEISHU_AUTO_SYNC_DEBOUNCE_MS = 60_000;
export const FEISHU_AUTO_SYNC_QUEUE_MAX_ITEMS = 200;

export const GITHUB_AUTO_SYNC_QUEUE_STORAGE_KEY = 'github_auto_sync_queue_v1' as const;
export const GITHUB_AUTO_SYNC_DEBOUNCE_MS = 60_000;
export const GITHUB_AUTO_SYNC_QUEUE_MAX_ITEMS = 200;

export const AUTO_SYNC_CONVERSATION_CHANGED_REASONS = {
  createConversation: 'createConversation',
  upsertConversation: 'upsertConversation',
  syncConversationMessages: 'syncConversationMessages',
  backfillImages: 'backfillImages',
  articleCommentChanged: 'articleCommentChanged',
} as const;

export type AutoSyncConversationChangedReason =
  (typeof AUTO_SYNC_CONVERSATION_CHANGED_REASONS)[keyof typeof AUTO_SYNC_CONVERSATION_CHANGED_REASONS];
