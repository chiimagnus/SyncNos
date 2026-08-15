import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@collectors/video/video-transcript-extract', () => ({
  extractVideoTranscriptFromCurrentPage: mocks.extract,
}));

vi.mock('@services/conversations/client/repo', () => ({
  saveConversationSnapshot: mocks.save,
}));

import { createVideoTranscriptCaptureService } from '@services/bootstrap/video-transcript-capture';

describe('video transcript capture', () => {
  beforeEach(() => {
    mocks.extract.mockReset();
    mocks.save.mockReset();
  });

  it('persists one snapshot with its transcript message', async () => {
    mocks.extract.mockResolvedValue({
      cues: [
        { start: 1, text: 'first line' },
        { start: 65, text: 'second line' },
      ],
      hasTimestamps: true,
      meta: {
        author: 'Creator',
        platform: 'youtube',
        title: 'Video',
        url: 'https://example.test/video',
      },
      source: 'youtube-captions',
    });
    mocks.save.mockResolvedValue({ conversationId: 19, isNew: true });

    const result = await createVideoTranscriptCaptureService({ runtime: { send: vi.fn() } }).captureVideoTranscript();

    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        conversation: expect.objectContaining({
          conversationKey: 'video:https://example.test/video',
          source: 'video',
          sourceType: 'video',
        }),
        diff: null,
        mode: 'snapshot',
        messages: [
          expect.objectContaining({
            contentMarkdown: '00:01 first line\n01:05 second line',
            contentText: 'first line\nsecond line',
            messageKey: 'video_transcript',
          }),
        ],
      }),
    );
    expect(result).toMatchObject({ conversationId: 19, isNew: true, subtitleStatus: 'ok' });
  });

  it('does not create a conversation when captions are empty', async () => {
    mocks.extract.mockResolvedValue({
      cues: [],
      hasTimestamps: false,
      meta: { title: 'Video', url: 'https://example.test/video' },
    });

    await expect(
      createVideoTranscriptCaptureService({ runtime: { send: vi.fn() } }).captureVideoTranscript(),
    ).resolves.toMatchObject({ conversationId: null, subtitleStatus: 'empty' });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
