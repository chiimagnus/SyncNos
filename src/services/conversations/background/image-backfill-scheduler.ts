import { create, clear, isAlarmsAvailable } from '@platform/alarms/alarms';
import { backfillConversationImages } from '@services/conversations/background/image-backfill-job';
import { storageGet, storageSet } from '@services/shared/storage';
import {
  AUTO_SYNC_CONVERSATION_CHANGED_REASONS,
  type AutoSyncConversationChangedReason,
} from '@services/sync/auto-sync/auto-sync-keys';
import {
  createAutoSyncSchedulerCore,
  type AutoSyncScheduler,
  type AutoSyncSchedulerInfra,
} from '@services/sync/auto-sync/auto-sync-scheduler-core';

export const AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY = 'ai_chat_image_backfill_queue_v1';
export const AI_CHAT_IMAGE_BACKFILL_ALARM_NAME = 'syncnos_ai_chat_image_backfill';
export const AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY = 'ai_chat_cache_images_enabled';
export const AI_CHAT_IMAGE_BACKFILL_RETRY_MS = 60_000;
const AI_CHAT_IMAGE_BACKFILL_QUEUE_MAX_ITEMS = 200;

export type ImageBackfillScheduler = AutoSyncScheduler;

export function createImageBackfillScheduler(
  deps: {
    onConversationChanged: (conversationId: number, reason: AutoSyncConversationChangedReason) => void | Promise<void>;
  },
  infraOverrides?: Partial<AutoSyncSchedulerInfra>,
): ImageBackfillScheduler {
  const infra: AutoSyncSchedulerInfra = {
    now: () => Date.now(),
    storage: { get: storageGet as any, set: storageSet as any },
    alarms: {
      isAvailable: () => isAlarmsAvailable(),
      create: (name, info) => create(name, info),
      clear: (name) => clear(name),
    },
    ...infraOverrides,
  };

  return createAutoSyncSchedulerCore({
    queueStorageKey: AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY,
    enabledStorageKey: AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY,
    alarmName: AI_CHAT_IMAGE_BACKFILL_ALARM_NAME,
    debounceMs: 0,
    maxItems: AI_CHAT_IMAGE_BACKFILL_QUEUE_MAX_ITEMS,
    infra,
    getInstanceId: () => 'image-backfill',
    isProviderEnabled: async () => true,
    flushWhenAlarmsUnavailable: false,
    syncConversations: async (conversationIds) => {
      const retryConversationIds: number[] = [];
      for (const conversationId of conversationIds) {
        try {
          const result = await backfillConversationImages({ conversationId });
          if (Number(result.updatedMessages) > 0) {
            await deps.onConversationChanged(conversationId, AUTO_SYNC_CONVERSATION_CHANGED_REASONS.backfillImages);
          }
          if (Array.isArray(result.warningFlags) && result.warningFlags.length > 0) {
            retryConversationIds.push(conversationId);
          }
        } catch (_error) {
          retryConversationIds.push(conversationId);
        }
      }
      return retryConversationIds.length
        ? { retryConversationIds, retryDelayMs: AI_CHAT_IMAGE_BACKFILL_RETRY_MS }
        : undefined;
    },
  });
}
