import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  extractVideoTranscriptFromCurrentPage: vi.fn(),
}));

vi.mock('@collectors/video/video-transcript-extract', () => ({
  extractVideoTranscriptFromCurrentPage: mocks.extractVideoTranscriptFromCurrentPage,
}));

import { createVideoTranscriptCaptureService } from '../../src/services/bootstrap/video-transcript-capture';
import { CORE_MESSAGE_TYPES } from '../../src/platform/messaging/message-contracts';

function successfulRuntime() {
  const send = vi.fn(async (type: string) => {
    if (type === CORE_MESSAGE_TYPES.UPSERT_CONVERSATION) {
      return { ok: true, data: { id: 7, __isNew: true }, error: null };
    }
    if (type === CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES) {
      return { ok: true, data: { upserted: 1, deleted: 0 }, error: null };
    }
    throw new Error(`unexpected type: ${type}`);
  });
  return { send };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('video transcript capture service', () => {
  it('persists canonical metadata, cues, chapters and lossless Markdown with canonical message names', async () => {
    mocks.extractVideoTranscriptFromCurrentPage.mockResolvedValue({
      meta: {
        platform: 'bilibili',
        url: 'https://www.bilibili.com/video/BV1TEST12345/',
        title: 'Video title',
        author: 'Author',
        description: 'Full description\nsecond line',
        durationSeconds: 123.5,
        thumbnailUrl: 'https://example.com/thumb.jpg',
      },
      cues: [
        { start: 1.234, end: 3.456, text: 'hello', sid: 1 },
        { start: 5, text: 'world' },
      ],
      chapters: [
        { title: 'Intro', startSeconds: 0, endSeconds: 30, imgUrl: 'raw' },
        { title: 'Main', startSeconds: 30, endSeconds: null },
      ],
    });
    const runtime = successfulRuntime();
    const service = createVideoTranscriptCaptureService({ runtime });

    await expect(service.captureVideoTranscript()).resolves.toEqual({
      conversationId: 7,
      title: 'Video title',
      url: 'https://www.bilibili.com/video/BV1TEST12345/',
      isNew: true,
      subtitleStatus: 'ok',
    });

    expect(runtime.send).toHaveBeenNthCalledWith(1, CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
      payload: {
        sourceType: 'video',
        source: 'video',
        conversationKey: 'video:https://www.bilibili.com/video/BV1TEST12345/',
        title: 'Video title',
        url: 'https://www.bilibili.com/video/BV1TEST12345/',
        author: 'Author',
        lastActivityAt: 0,
        platform: 'bilibili',
        durationSeconds: 123.5,
        thumbnailUrl: 'https://example.com/thumb.jpg',
        videoDescription: 'Full description\nsecond line',
      },
    });
    expect((runtime.send.mock.calls[0]?.[1] as any)?.payload).not.toHaveProperty('publishedAt');
    expect((runtime.send.mock.calls[0]?.[1] as any)?.payload).not.toHaveProperty('warningFlags');
    expect((runtime.send.mock.calls[0]?.[1] as any)?.payload).not.toHaveProperty('transcriptSource');
    expect((runtime.send.mock.calls[0]?.[1] as any)?.payload).not.toHaveProperty('hasTimestamps');

    expect(runtime.send).toHaveBeenNthCalledWith(
      2,
      CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES,
      expect.objectContaining({
        conversationId: 7,
        mode: 'snapshot',
        conversationSourceType: 'video',
        conversationUrl: 'https://www.bilibili.com/video/BV1TEST12345/',
        messages: [
          {
            messageKey: 'video_transcript',
            role: 'transcript',
            contentMarkdown: '[00:01.234 → 00:03.456] hello\n[00:05] world',
            transcriptCues: [
              { startSeconds: 1.234, endSeconds: 3.456, text: 'hello' },
              { startSeconds: 5, endSeconds: null, text: 'world' },
            ],
            videoChapters: [
              { title: 'Intro', startSeconds: 0, endSeconds: 30 },
              { title: 'Main', startSeconds: 30, endSeconds: null },
            ],
            sequence: 1,
            updatedAt: expect.any(Number),
          },
        ],
      }),
    );
  });

  it('omits chapters when this capture did not observe a trustworthy chapter response', async () => {
    mocks.extractVideoTranscriptFromCurrentPage.mockResolvedValue({
      meta: {
        platform: 'youtube',
        url: 'https://www.youtube.com/watch?v=test',
        title: 'YouTube',
        author: '',
        description: '',
        durationSeconds: null,
        thumbnailUrl: '',
      },
      cues: [{ start: 1, end: 2, text: 'subtitle' }],
      chapters: null,
    });
    const runtime = successfulRuntime();

    await createVideoTranscriptCaptureService({ runtime }).captureVideoTranscript();
    const message = ((runtime.send.mock.calls[1]?.[1] as any)?.messages || [])[0];
    expect(message).not.toHaveProperty('videoChapters');
    expect(message.transcriptCues).toEqual([{ startSeconds: 1, endSeconds: 2, text: 'subtitle' }]);
  });

  it('sends an explicit empty chapter array so storage can clear previous chapters', async () => {
    mocks.extractVideoTranscriptFromCurrentPage.mockResolvedValue({
      meta: {
        platform: 'bilibili',
        url: 'https://www.bilibili.com/video/BV1TEST12345/',
        title: 'Video',
        author: '',
        description: '',
        durationSeconds: null,
        thumbnailUrl: '',
      },
      cues: [{ start: 1, text: 'subtitle' }],
      chapters: [],
    });
    const runtime = successfulRuntime();

    await createVideoTranscriptCaptureService({ runtime }).captureVideoTranscript();
    const message = ((runtime.send.mock.calls[1]?.[1] as any)?.messages || [])[0];
    expect(message.videoChapters).toEqual([]);
  });

  it('does not create an empty Video when no canonical cues remain', async () => {
    mocks.extractVideoTranscriptFromCurrentPage.mockResolvedValue({
      meta: {
        platform: 'bilibili',
        url: 'https://www.bilibili.com/video/BV1TEST12345/',
        title: 'No subtitles',
        author: '',
        description: 'context',
        durationSeconds: 10,
        thumbnailUrl: '',
      },
      cues: [
        { start: null, end: 2, text: 'invalid' },
        { start: 1, text: '' },
      ],
      chapters: [{ title: 'Chapter', startSeconds: 0, endSeconds: 10 }],
    });
    const runtime = successfulRuntime();

    await expect(createVideoTranscriptCaptureService({ runtime }).captureVideoTranscript()).resolves.toEqual({
      conversationId: null,
      title: 'No subtitles',
      url: 'https://www.bilibili.com/video/BV1TEST12345/',
      subtitleStatus: 'empty',
    });
    expect(runtime.send).not.toHaveBeenCalled();
  });

  it('propagates canonical runtime failures instead of reporting a saved Video', async () => {
    mocks.extractVideoTranscriptFromCurrentPage.mockResolvedValue({
      meta: {
        platform: 'youtube',
        url: 'https://www.youtube.com/watch?v=test',
        title: 'Video',
        author: '',
        description: '',
        durationSeconds: 10,
        thumbnailUrl: '',
      },
      cues: [{ start: 1, text: 'subtitle' }],
      chapters: null,
    });

    const upsertFailure = {
      send: vi.fn(async () => ({ ok: false, data: null, error: { message: 'upsert failed' } })),
    };
    await expect(
      createVideoTranscriptCaptureService({ runtime: upsertFailure }).captureVideoTranscript(),
    ).rejects.toThrow('upsert failed');

    const syncFailure = {
      send: vi.fn(async (type: string) =>
        type === CORE_MESSAGE_TYPES.UPSERT_CONVERSATION
          ? { ok: true, data: { id: 9, __isNew: false }, error: null }
          : { ok: false, data: null, error: { message: 'sync failed' } },
      ),
    };
    await expect(
      createVideoTranscriptCaptureService({ runtime: syncFailure }).captureVideoTranscript(),
    ).rejects.toThrow('sync failed');
  });
});
