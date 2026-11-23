import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutoSyncSchedulerInfra } from '@services/sync/auto-sync/auto-sync-scheduler-core';

const backfillMocks = vi.hoisted(() => ({ backfillConversationImages: vi.fn() }));
vi.mock('@services/conversations/background/image-backfill-job', () => backfillMocks);

import {
  AI_CHAT_IMAGE_BACKFILL_ALARM_NAME,
  AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY,
  createImageBackfillScheduler,
} from '@services/conversations/background/image-backfill-scheduler';

const AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY = 'ai_chat_cache_images_enabled';

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

function result(input: Partial<{ updatedMessages: number; conflicts: number; warningFlags: string[] }> = {}) {
  return {
    scannedMessages: 1,
    updatedMessages: input.updatedMessages ?? 0,
    conflicts: input.conflicts ?? 0,
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

  it('persists and processes article work even when AI chat image caching is disabled', async () => {
    const pack = makeInfra();
    pack.storage[AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY] = false;
    const scheduler = createImageBackfillScheduler({ onConversationChanged: vi.fn() }, pack.infra);

    await scheduler.enqueue(7, 'chat_image');

    expect(pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]).toEqual({ '7': pack.infra.now() });
    expect(pack.alarm.name).toBe(AI_CHAT_IMAGE_BACKFILL_ALARM_NAME);
    await scheduler.flush();
    expect(backfillMocks.backfillConversationImages).toHaveBeenCalledWith({ conversationId: 7 });
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

  it('keeps only failed conversations queued for delayed retry without repeating successful backfills', async () => {
    const pack = makeInfra();
    const now = pack.infra.now();
    pack.storage[AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY] = true;
    pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY] = {
      '7': now,
      '8': now,
      '9': now + 30_000,
      '10': now,
    };
    backfillMocks.backfillConversationImages.mockImplementation(async ({ conversationId }: any) => {
      if (conversationId === 7) return result({ updatedMessages: 1 });
      if (conversationId === 8) return result({ warningFlags: ['chatgpt_images_cache_incomplete'] });
      if (conversationId === 10) throw new Error('download failed');
      throw new Error(`unexpected id ${conversationId}`);
    });
    const onConversationChanged = vi.fn(async () => {});
    const scheduler = createImageBackfillScheduler({ onConversationChanged }, pack.infra);

    await scheduler.flush();

    expect(backfillMocks.backfillConversationImages).toHaveBeenCalledTimes(3);
    expect(backfillMocks.backfillConversationImages).toHaveBeenNthCalledWith(1, { conversationId: 7 });
    expect(backfillMocks.backfillConversationImages).toHaveBeenNthCalledWith(2, { conversationId: 8 });
    expect(backfillMocks.backfillConversationImages).toHaveBeenNthCalledWith(3, { conversationId: 10 });
    expect(onConversationChanged).toHaveBeenCalledWith(7, 'backfillImages');
    expect(onConversationChanged).not.toHaveBeenCalledWith(8, expect.anything());
    expect(pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]).toEqual({
      '8': now + 60_000,
      '9': now + 30_000,
      '10': now + 60_000,
    });
    expect(pack.alarm.when).toBe(now + 30_000);
  });

  it('keeps newly queued image recovery scoped to keys and falls back to full recovery after worker restart', async () => {
    const pack = makeInfra();
    pack.storage[AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY] = true;
    const scheduler = createImageBackfillScheduler({ onConversationChanged: vi.fn() }, pack.infra);
    await scheduler.enqueueWithKeys(7, ['new-1', 'new-2']);
    expect(pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]).toEqual({ '7': pack.infra.now() });
    await scheduler.flush();
    expect(backfillMocks.backfillConversationImages).toHaveBeenCalledWith({
      conversationId: 7,
      messageKeys: ['new-1', 'new-2'],
    });

    // An MV3 service-worker restart loses only the optional in-memory hint, not the durable conversation queue.
    await scheduler.enqueueWithKeys(7, ['new-3']);
    const restarted = createImageBackfillScheduler({ onConversationChanged: vi.fn() }, pack.infra);
    await restarted.flush();
    expect(backfillMocks.backfillConversationImages).toHaveBeenLastCalledWith({ conversationId: 7 });
  });

  it('does not narrow a previously queued full-image recovery when a new incremental image arrives', async () => {
    const pack = makeInfra();
    pack.storage[AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY] = true;
    pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY] = { '7': pack.infra.now() };
    const scheduler = createImageBackfillScheduler({ onConversationChanged: vi.fn() }, pack.infra);
    await scheduler.enqueueWithKeys(7, ['new-image']);
    await scheduler.flush();
    expect(backfillMocks.backfillConversationImages).toHaveBeenLastCalledWith({ conversationId: 7 });
  });

  it('retains a failed scoped download in the durable queue and retries after connectivity returns', async () => {
    const pack = makeInfra();
    pack.storage[AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY] = true;
    let attempts = 0;
    backfillMocks.backfillConversationImages.mockImplementation(async () => {
      attempts += 1;
      return result(attempts === 1 ? { warningFlags: ['chatgpt_images_cache_incomplete'] } : {});
    });
    const scheduler = createImageBackfillScheduler({ onConversationChanged: vi.fn() }, pack.infra);
    await scheduler.enqueueWithKeys(7, ['new-image']);
    await scheduler.flush();
    const retryAt = pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]?.['7'];
    expect(retryAt).toBeGreaterThan(pack.infra.now());
    pack.setNow(retryAt);
    await scheduler.flush();
    expect(backfillMocks.backfillConversationImages).toHaveBeenNthCalledWith(2, {
      conversationId: 7,
      messageKeys: ['new-image'],
    });
    expect(pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]).toEqual({});
  });

  it('recovers a failed image job after worker restart without losing the durable queue', async () => {
    const pack = makeInfra();
    pack.storage[AI_CHAT_IMAGE_CACHE_ENABLED_STORAGE_KEY] = true;
    backfillMocks.backfillConversationImages
      .mockResolvedValueOnce(result({ warningFlags: ['chatgpt_images_cache_incomplete'] }))
      .mockResolvedValue(result());
    const scheduler = createImageBackfillScheduler({ onConversationChanged: vi.fn() }, pack.infra);
    await scheduler.enqueueWithKeys(7, ['new-image']);
    await scheduler.flush();
    const retryAt = pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]['7'];
    const restarted = createImageBackfillScheduler({ onConversationChanged: vi.fn() }, pack.infra);
    pack.setNow(retryAt);
    await restarted.flush();

    expect(backfillMocks.backfillConversationImages).toHaveBeenNthCalledWith(1, {
      conversationId: 7,
      messageKeys: ['new-image'],
    });
    expect(backfillMocks.backfillConversationImages).toHaveBeenNthCalledWith(2, { conversationId: 7 });
    expect(pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]).toEqual({});
  });

  it('retries transient HTTP failures and concurrent Markdown edits, not permanent HTTP rejections', async () => {
    const pack = makeInfra();
    const now = pack.infra.now();
    pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY] = { '21': now, '22': now, '23': now };
    backfillMocks.backfillConversationImages.mockImplementation(async ({ conversationId }: any) => {
      if (conversationId === 21) return result({ warningFlags: ['inline_images_cache_incomplete'] });
      if (conversationId === 22) return result({ conflicts: 1 });
      return result({ warningFlags: ['inline_images_download_failed'] });
    });
    const scheduler = createImageBackfillScheduler({ onConversationChanged: vi.fn() }, pack.infra);
    await scheduler.flush();
    expect(pack.storage[AI_CHAT_IMAGE_BACKFILL_QUEUE_STORAGE_KEY]).toEqual({
      '21': now + 60_000,
      '22': now + 60_000,
    });
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
