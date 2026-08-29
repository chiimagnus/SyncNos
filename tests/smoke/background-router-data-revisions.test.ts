import { describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { DATA_REVISION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { registerDataRevisionHandlers } from '@services/data-revisions/background-handlers';

function createRouter() {
  return createBackgroundRouter({
    fallback: (message) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${message?.type}`, extra: null },
    }),
  });
}

describe('background data revision request', () => {
  it('returns only the numeric revision vector', async () => {
    const router = createRouter();
    const readSnapshot = vi.fn(async () => ({
      conversations: 1,
      messages: 2,
      sync_mappings: 3,
      article_comments: 4,
      image_cache: 5,
    }));
    registerDataRevisionHandlers(router, { readSnapshot });

    await expect(router.__handleMessageForTests({ type: DATA_REVISION_MESSAGE_TYPES.GET_SNAPSHOT })).resolves.toEqual({
      ok: true,
      data: {
        conversations: 1,
        messages: 2,
        sync_mappings: 3,
        article_comments: 4,
        image_cache: 5,
      },
      error: null,
    });
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it('returns the router error contract when the authoritative snapshot read fails', async () => {
    const router = createRouter();
    const readSnapshot = vi.fn(async () => {
      throw new Error('snapshot_unstable');
    });
    registerDataRevisionHandlers(router, { readSnapshot });

    await expect(router.__handleMessageForTests({ type: DATA_REVISION_MESSAGE_TYPES.GET_SNAPSHOT })).resolves.toEqual({
      ok: false,
      data: null,
      error: { message: 'snapshot_unstable', extra: null },
    });
  });
});
