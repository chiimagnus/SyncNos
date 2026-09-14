import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutoSyncSchedulerInfra } from '@services/sync/auto-sync/auto-sync-scheduler-core';

const backfillMocks = vi.hoisted(() => ({ backfillConversationImages: vi.fn() }));
vi.mock('@services/conversations/background/image-backfill-job', () => backfillMocks);

import {
  AI_CHAT_IMAGE_BACKFILL_ALARM_NAME,
  AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY,
  AI_CHAT_IMAGE_BACKFILL_RETRY_MS,
  AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY,
  createImageBackfillScheduler,
} from '@services/conversations/background/image-backfill-scheduler';

function makeInfra(startNow = 1_000_000, alarmsAvailable = true) {
  let now = startNow;
  const storage: Record<string, any> = {};
  const alarm = { name: '', when: 0, cleared: false };
  const infra: AutoSyncSchedulerInfra = {
    now: () => now,
    storage: {
      get: async (keys) => Object.fromEntries(keys.map((key) => [key, storage[key]])),
      set: async (patch) => {
        Object.assign(storage, patch);
      },
    },
    alarms: {
      isAvailable: () => alarmsAvailable,
      create: (name, info) => {
        alarm.name = name;
        alarm.when = info.when;
        alarm.cleared = false;
        return true;
      },
      clear: async (name) => {
        if (alarm.name === name) alarm.cleared = true;
        return true;
      },
    },
  };
  return {
    infra,
    storage,
    alarm,
    setNow: (value: number) => {
      now = value;
    },
  };
}

function result(input: Partial<{ updatedMessages: number; warningFlags: string[] }> = {}) {
  return {
    scannedMessages: 1,
    updatedMessages: input.updatedMessages ?? 0,
    inlinedCount: 0,
    fromCacheCount: 0,
    downloadedCount: 0,
    inlinedBytes: 0,
    warningFlags: input.warningFlags ?? [],
  };
}

describe('image backfill scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backfillMocks.backfillConversationImages.mockResolvedValue(result());
  });

  it('does not enqueue when AI chat image caching is disabled', async () => {
    const pack = makeInfra();
    pack.storage[AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY] = false;
    const scheduler = createImageBackfillScheduler({ onConversationChanged: vi.fn() }, pack.infra);

    await scheduler.enqueue(7, 'chat_image');

    expect(pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]).toBeUndefined();
    expect(pack.alarm.name).toBe('');
    expect(backfillMocks.backfillConversationImages).not.toHaveBeenCalled();
  });

  it('durably enqueues and schedules an alarm without downloading in the enqueue request', async () => {
    const pack = makeInfra();
    pack.storage[AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY] = true;
    const scheduler = createImageBackfillScheduler({ onConversationChanged: vi.fn() }, pack.infra);

    await scheduler.enqueue(7, 'chat_image');

    expect(pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]).toEqual({ '7': pack.infra.now() });
    expect(pack.alarm).toMatchObject({ name: AI_CHAT_IMAGE_BACKFILL_ALARM_NAME, when: pack.infra.now() });
    expect(backfillMocks.backfillConversationImages).not.toHaveBeenCalled();
  });

  it('flushes due work, notifies only changed conversations, and retries only incomplete ones', async () => {
    const pack = makeInfra();
    const now = pack.infra.now();
    pack.storage[AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY] = true;
    pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY] = { '7': now, '8': now, '9': now + 30_000 };
    backfillMocks.backfillConversationImages.mockImplementation(async ({ conversationId }: any) => {
      if (conversationId === 7) return result({ updatedMessages: 1 });
      if (conversationId === 8) return result({ warningFlags: ['chatgpt_images_cache_incomplete'] });
      throw new Error(`unexpected id ${conversationId}`);
    });
    const onConversationChanged = vi.fn(async () => {});
    const scheduler = createImageBackfillScheduler({ onConversationChanged }, pack.infra);

    await scheduler.flush();

    expect(backfillMocks.backfillConversationImages).toHaveBeenCalledTimes(2);
    expect(backfillMocks.backfillConversationImages).toHaveBeenNthCalledWith(1, { conversationId: 7 });
    expect(backfillMocks.backfillConversationImages).toHaveBeenNthCalledWith(2, { conversationId: 8 });
    expect(onConversationChanged).toHaveBeenCalledWith(7, 'backfillImages');
    expect(onConversationChanged).not.toHaveBeenCalledWith(8, expect.anything());
    expect(pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]).toEqual({
      '8': now + AI_CHAT_IMAGE_BACKFILL_RETRY_MS,
      '9': now + 30_000,
    });
    expect(pack.alarm.when).toBe(now + 30_000);
  });

  it('keeps durable work queued without falling back to synchronous downloads when alarms are unavailable', async () => {
    const pack = makeInfra(1_000_000, false);
    pack.storage[AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY] = true;
    const scheduler = createImageBackfillScheduler({ onConversationChanged: vi.fn() }, pack.infra);

    await scheduler.enqueue(7, 'chat_image');

    expect(pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]).toEqual({ '7': pack.infra.now() });
    expect(backfillMocks.backfillConversationImages).not.toHaveBeenCalled();
  });
});
