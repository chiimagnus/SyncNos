import { create, clear, isAlarmsAvailable } from '@platform/alarms/alarms';
import { backfillConversationImages } from '@services/conversations/background/image-backfill-job';
import { storageGet, storageSet } from '@services/shared/storage';
import {
  AUTO_SYNC_CONVERSATION_CHANGED_REASONS,
  type AutoSyncConversationChangedReason,
} from '@services/sync/auto-sync/auto-sync-keys';
import {
  createAutoSyncSchedulerCore,
  normalizeAutoSyncQueue,
  type AutoSyncScheduler,
  type AutoSyncSchedulerInfra,
} from '@services/sync/auto-sync/auto-sync-scheduler-core';

export const AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY = 'ai_chat_image_backfill_queue_v1';
export const AI_CHAT_IMAGE_BACKFILL_ALARM_NAME = 'syncnos_ai_chat_image_backfill';
const AI_CHAT_IMAGE_BACKFILL_QUEUE_MAX_ITEMS = 200;
const AI_CHAT_IMAGE_BACKFILL_RETRY_DELAY_MS = 60_000;

export type ImageBackfillScheduler = AutoSyncScheduler & {
  enqueueWithKeys: (conversationId: number, messageKeys: string[]) => Promise<void>;
};

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

  const pendingKeysByConversation = new Map<number, Set<string>>();
  const scheduler = createAutoSyncSchedulerCore({
    queueStorageKey: AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY,
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
        const pending = pendingKeysByConversation.get(conversationId);
        const messageKeys = pending?.size ? Array.from(pending) : undefined;
        try {
          const result = await backfillConversationImages({
            conversationId,
            ...(messageKeys ? { messageKeys } : null),
          });
          if (
            result.conflicts > 0 ||
            result.warningFlags.includes('chatgpt_images_cache_incomplete') ||
            result.warningFlags.includes('inline_images_cache_incomplete')
          ) {
            retryConversationIds.push(conversationId);
          } else if (messageKeys) {
            for (const key of messageKeys) pending?.delete(key);
            if (!pending?.size) pendingKeysByConversation.delete(conversationId);
          }
          if (Number(result.updatedMessages) > 0) {
            await deps.onConversationChanged(conversationId, AUTO_SYNC_CONVERSATION_CHANGED_REASONS.backfillImages);
          }
        } catch (_error) {
          retryConversationIds.push(conversationId);
        }
      }
      return { retryConversationIds, retryDelayMs: AI_CHAT_IMAGE_BACKFILL_RETRY_DELAY_MS };
    },
  });
  return {
    enqueue: async (conversationId, reason) => {
      pendingKeysByConversation.delete(conversationId);
      await scheduler.enqueue(conversationId, reason);
    },
    flush: scheduler.flush,
    enqueueWithKeys: async (conversationId, messageKeys) => {
      if (!Number.isSafeInteger(conversationId) || conversationId <= 0) return;
      const keys = messageKeys.map((key) => String(key || '').trim()).filter(Boolean);
      if (!keys.length) return scheduler.enqueue(conversationId, 'chat_image');
      if (!pendingKeysByConversation.has(conversationId)) {
        const persisted = await infra.storage.get([AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]);
        const queue = normalizeAutoSyncQueue(persisted[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]);
        if (Object.hasOwn(queue, String(conversationId))) {
          // An existing full or pre-restart job may contain older uncached images.
          return scheduler.enqueue(conversationId, 'chat_image');
        }
      }
      const pending = pendingKeysByConversation.get(conversationId) || new Set<string>();
      for (const key of keys) pending.add(key);
      pendingKeysByConversation.set(conversationId, pending);
      await scheduler.enqueue(conversationId, 'chat_image');
    },
  };
}
