import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

const extractionMocks = vi.hoisted(() => ({
  fixture: null as any,
  extract: vi.fn(async () => extractionMocks.fixture),
}));

vi.mock('@collectors/video/video-transcript-extract', () => ({
  extractVideoTranscriptFromCurrentPage: extractionMocks.extract,
}));

import { ARTICLE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { createBackgroundRouter } from '@platform/messaging/background-router';
import { registerConversationHandlers } from '@services/conversations/background/handlers';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture';
import { createVideoTranscriptCaptureService } from '@services/bootstrap/video-transcript-capture';
import { closeDbForTests, openDb } from '../../src/platform/idb/schema';

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB request failed'));
  });
}

async function deleteDb() {
  closeDbForTests();
  await reqToPromise(indexedDB.deleteDatabase('webclipper') as any);
}

async function readVideoRows() {
  const db = await openDb();
  const tx = db.transaction(['conversations', 'messages'], 'readonly');
  const conversations = await reqToPromise<any[]>(tx.objectStore('conversations').getAll() as any);
  const messages = await reqToPromise<any[]>(tx.objectStore('messages').getAll() as any);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
  return { conversations, messages };
}

function fixture(input: { description: string; text: string; start: number; end: number; chapters: any[] | null }) {
  return {
    meta: {
      platform: 'bilibili',
      url: 'https://www.bilibili.com/video/BV1FwY4zkEef/',
      title: 'Video title',
      author: 'Creator',
      description: input.description,
      durationSeconds: 14236.25,
      thumbnailUrl: 'https://example.com/thumb.jpg',
    },
    cues: [{ start: input.start, end: input.end, text: input.text }],
    chapters: input.chapters,
  };
}

function installChromeStorage() {
  const store: Record<string, unknown> = {};
  // @ts-expect-error test global
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys: any, callback: (value: Record<string, unknown>) => void) {
          const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
          const out: Record<string, unknown> = {};
          for (const key of list) out[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : undefined;
          callback(out);
        },
        set(payload: Record<string, unknown>, callback?: () => void) {
          Object.assign(store, payload || {});
          callback?.();
        },
      },
    },
  };
}

describe('Video Current Page persistence pipeline', () => {
  beforeEach(async () => {
    // @ts-expect-error test global
    globalThis.indexedDB = indexedDB;
    // @ts-expect-error test global
    globalThis.IDBKeyRange = IDBKeyRange;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'https://www.bilibili.com/video/BV1FwY4zkEef/' },
    });
    installChromeStorage();
    extractionMocks.extract.mockClear();
    await deleteDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await deleteDb();
    // @ts-expect-error test global cleanup
    delete globalThis.chrome;
    // @ts-expect-error test global cleanup
    delete globalThis.location;
  });

  it('routes Bilibili Video ahead of web fallback and preserves one canonical Video row across recaptures', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const router = createBackgroundRouter({
      fallback: (msg: any) => ({
        ok: false,
        data: null,
        error: { message: `unexpected message type: ${msg?.type}`, extra: null },
      }),
    });
    registerConversationHandlers(router, {
      onConversationChanged: async () => {},
      onRemoteCleanupPending: async () => {},
    });

    const sentTypes: string[] = [];
    const runtime = {
      send: async (type: string, payload: Record<string, unknown> = {}) => {
        sentTypes.push(type);
        if (
          type === ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB ||
          type === ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB
        ) {
          throw new Error(`Article route must not be used for Video: ${type}`);
        }
        return await router.__handleMessageForTests({ type, ...payload });
      },
    };
    const webCollector = { capture: vi.fn(() => null) };
    const videoCapture = createVideoTranscriptCaptureService({ runtime });
    const currentPage = createCurrentPageCaptureService({
      runtime,
      videoCapture,
      collectorsRegistry: {
        pickActive: () => ({ id: 'web', collector: webCollector }),
        list: () => [],
      },
    });

    extractionMocks.fixture = fixture({
      description: 'Description v1',
      text: 'first line',
      start: 1.234,
      end: 3.456,
      chapters: [{ title: 'Intro', startSeconds: 0, endSeconds: 30 }],
    });
    const first = await currentPage.captureCurrentPage();
    expect(first).toMatchObject({ kind: 'video', subtitleStatus: 'ok', isNew: true });
    expect(webCollector.capture).not.toHaveBeenCalled();

    let stored = await readVideoRows();
    expect(stored.conversations).toHaveLength(1);
    expect(stored.messages).toHaveLength(1);
    const firstConversationId = stored.conversations[0].id;
    expect(stored.conversations[0]).toMatchObject({
      id: firstConversationId,
      sourceType: 'video',
      source: 'video',
      conversationKey: 'video:https://www.bilibili.com/video/BV1FwY4zkEef/',
      url: 'https://www.bilibili.com/video/BV1FwY4zkEef/',
      platform: 'bilibili',
      author: 'Creator',
      durationSeconds: 14236.25,
      thumbnailUrl: 'https://example.com/thumb.jpg',
      videoDescription: 'Description v1',
      lastActivityAt: 1_000,
    });
    expect(stored.conversations.some((row) => row.source === 'web')).toBe(false);
    expect(stored.messages[0]).toMatchObject({
      conversationId: firstConversationId,
      messageKey: 'video_transcript',
      role: 'transcript',
      contentMarkdown: '[00:01.234 → 00:03.456] first line',
      transcriptCues: [{ startSeconds: 1.234, endSeconds: 3.456, text: 'first line' }],
      videoChapters: [{ title: 'Intro', startSeconds: 0, endSeconds: 30 }],
    });

    now = 2_000;
    extractionMocks.fixture = fixture({
      description: 'Description v2',
      text: 'updated line',
      start: 4.567,
      end: 6.789,
      chapters: [{ title: 'Updated', startSeconds: 30, endSeconds: 60 }],
    });
    const second = await currentPage.captureCurrentPage();
    expect(second).toMatchObject({
      kind: 'video',
      subtitleStatus: 'ok',
      isNew: false,
      conversationId: firstConversationId,
    });
    stored = await readVideoRows();
    expect(stored.conversations).toHaveLength(1);
    expect(stored.messages).toHaveLength(1);
    expect(stored.conversations[0]).toMatchObject({
      id: firstConversationId,
      videoDescription: 'Description v2',
      lastActivityAt: 2_000,
    });
    expect(stored.messages[0]).toMatchObject({
      contentMarkdown: '[00:04.567 → 00:06.789] updated line',
      transcriptCues: [{ startSeconds: 4.567, endSeconds: 6.789, text: 'updated line' }],
      videoChapters: [{ title: 'Updated', startSeconds: 30, endSeconds: 60 }],
    });

    now = 3_000;
    extractionMocks.fixture = fixture({
      description: 'Description v3',
      text: 'chapters unknown',
      start: 7,
      end: 8,
      chapters: null,
    });
    await currentPage.captureCurrentPage();
    stored = await readVideoRows();
    expect(stored.messages).toHaveLength(1);
    expect(stored.messages[0].videoChapters).toEqual([{ title: 'Updated', startSeconds: 30, endSeconds: 60 }]);
    expect(stored.conversations[0].lastActivityAt).toBe(3_000);

    now = 4_000;
    extractionMocks.fixture = fixture({
      description: 'Description v4',
      text: 'chapters cleared',
      start: 9,
      end: 10,
      chapters: [],
    });
    await currentPage.captureCurrentPage();
    stored = await readVideoRows();
    expect(stored.messages).toHaveLength(1);
    expect(stored.messages[0].videoChapters).toEqual([]);
    expect(stored.conversations[0].lastActivityAt).toBe(4_000);

    now = 5_000;
    extractionMocks.fixture = {
      ...fixture({
        description: 'Description without subtitles',
        text: 'unused',
        start: 11,
        end: 12,
        chapters: [{ title: 'Metadata-only chapter', startSeconds: 60, endSeconds: 90 }],
      }),
      cues: [],
    };
    const empty = await currentPage.captureCurrentPage();
    expect(empty).toMatchObject({
      kind: 'video',
      subtitleStatus: 'empty',
      conversationId: firstConversationId,
      isNew: false,
    });
    stored = await readVideoRows();
    expect(stored.conversations).toHaveLength(1);
    expect(stored.messages).toHaveLength(1);
    expect(stored.conversations[0].videoDescription).toBe('Description without subtitles');
    expect(stored.conversations[0].lastActivityAt).toBe(5_000);
    expect(stored.messages[0].contentMarkdown).toBe('[00:09 → 00:10] chapters cleared');
    expect(stored.messages[0].transcriptCues).toEqual([{ startSeconds: 9, endSeconds: 10, text: 'chapters cleared' }]);
    expect(stored.messages[0].videoChapters).toEqual([
      { title: 'Metadata-only chapter', startSeconds: 60, endSeconds: 90 },
    ]);

    now = 6_000;
    extractionMocks.fixture = {
      ...fixture({
        description: 'Description without subtitles again',
        text: 'unused',
        start: 13,
        end: 14,
        chapters: null,
      }),
      cues: [],
    };
    await currentPage.captureCurrentPage();
    stored = await readVideoRows();
    expect(stored.conversations[0].videoDescription).toBe('Description without subtitles again');
    expect(stored.conversations[0].lastActivityAt).toBe(6_000);
    expect(stored.messages[0].contentMarkdown).toBe('[00:09 → 00:10] chapters cleared');
    expect(stored.messages[0].transcriptCues).toEqual([{ startSeconds: 9, endSeconds: 10, text: 'chapters cleared' }]);
    expect(stored.messages[0].videoChapters).toEqual([
      { title: 'Metadata-only chapter', startSeconds: 60, endSeconds: 90 },
    ]);

    expect(sentTypes).not.toContain(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB);
    expect(sentTypes).not.toContain(ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB);
  });

  it('creates a new metadata-only Video when subtitles are absent on the first capture', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(7_000);
    const router = createBackgroundRouter({
      fallback: (msg: any) => ({
        ok: false,
        data: null,
        error: { message: `unexpected message type: ${msg?.type}`, extra: null },
      }),
    });
    registerConversationHandlers(router, {
      onConversationChanged: async () => {},
      onRemoteCleanupPending: async () => {},
    });
    const runtime = {
      send: async (type: string, payload: Record<string, unknown> = {}) => {
        if (
          type === ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB ||
          type === ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB
        ) {
          throw new Error(`Article route must not be used for Video: ${type}`);
        }
        return await router.__handleMessageForTests({ type, ...payload });
      },
    };
    const videoCapture = createVideoTranscriptCaptureService({ runtime });
    const currentPage = createCurrentPageCaptureService({
      runtime,
      videoCapture,
      collectorsRegistry: {
        pickActive: () => ({ id: 'web', collector: { capture: vi.fn(() => null) } }),
        list: () => [],
      },
    });

    extractionMocks.fixture = {
      ...fixture({
        description: 'Metadata-only description',
        text: 'unused',
        start: 1,
        end: 2,
        chapters: [{ title: 'Only chapter', startSeconds: 0, endSeconds: 45 }],
      }),
      cues: [],
    };
    const result = await currentPage.captureCurrentPage();
    expect(result).toMatchObject({ kind: 'video', subtitleStatus: 'empty', isNew: true });

    const stored = await readVideoRows();
    expect(stored.conversations).toHaveLength(1);
    expect(stored.conversations[0]).toMatchObject({
      sourceType: 'video',
      videoDescription: 'Metadata-only description',
      lastActivityAt: 7_000,
    });
    expect(stored.messages).toHaveLength(1);
    expect(stored.messages[0]).toMatchObject({
      messageKey: 'video_transcript',
      contentMarkdown: '',
      videoChapters: [{ title: 'Only chapter', startSeconds: 0, endSeconds: 45 }],
    });
    expect(stored.messages[0]).not.toHaveProperty('transcriptCues');
  });
});
