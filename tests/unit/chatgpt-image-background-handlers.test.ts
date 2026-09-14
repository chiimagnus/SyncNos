import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '../../src/platform/messaging/background-router';
import { CHATGPT_MESSAGE_TYPES } from '@platform/messaging/message-contracts';

const imageMocks = vi.hoisted(() => ({ resolveChatgptImageUrlsForStoredConversation: vi.fn() }));

vi.mock('@services/integrations/chatgpt/conversation-image-assets', () => imageMocks);

import { registerChatgptImageHandlers } from '@services/integrations/chatgpt/image-background-handlers';

function createRouter() {
  const router = createBackgroundRouter({
    fallback: (msg: any) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${msg?.type}`, extra: null },
    }),
  });
  registerChatgptImageHandlers(router as any);
  return router;
}

describe('ChatGPT image background handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageMocks.resolveChatgptImageUrlsForStoredConversation.mockResolvedValue([
      {
        fileId: 'file_image_1',
        ok: true,
        url: 'https://chatgpt.com/backend-api/estuary/content?id=file_image_1&sig=test',
      },
    ]);
  });

  it('resolves only normalized deduplicated file ids in the stored ChatGPT conversation scope', async () => {
    const router = createRouter();
    const response = await router.dispatch({
      type: CHATGPT_MESSAGE_TYPES.RESOLVE_IMAGE_URLS,
      conversationId: 7,
      fileIds: ['file_image_1', 'file_image_1', 'bad', '', null],
    });

    expect(response.ok).toBe(true);
    expect(imageMocks.resolveChatgptImageUrlsForStoredConversation).toHaveBeenCalledWith({
      conversationId: 7,
      fileIds: ['file_image_1'],
      concurrency: 4,
    });
  });

  it('rejects an invalid conversation id before resolving any signed URL', async () => {
    const router = createRouter();
    const invalid = await router.dispatch({
      type: CHATGPT_MESSAGE_TYPES.RESOLVE_IMAGE_URLS,
      conversationId: 0,
      fileIds: ['file_image_1'],
    });
    expect(invalid).toMatchObject({ ok: false, error: { message: 'invalid conversationId' } });
    expect(imageMocks.resolveChatgptImageUrlsForStoredConversation).not.toHaveBeenCalled();
  });

  it('returns an empty result without loading conversation metadata when no valid file ids remain', async () => {
    const router = createRouter();
    const response = await router.dispatch({
      type: CHATGPT_MESSAGE_TYPES.RESOLVE_IMAGE_URLS,
      conversationId: 7,
      fileIds: ['bad', '', null],
    });

    expect(response).toMatchObject({ ok: true, data: [] });
    expect(imageMocks.resolveChatgptImageUrlsForStoredConversation).not.toHaveBeenCalled();
  });
});
