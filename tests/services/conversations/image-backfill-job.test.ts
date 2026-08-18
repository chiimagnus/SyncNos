import { describe, expect, it, vi } from 'vitest';

import { backfillConversationImages } from '@services/conversations/background/image-backfill-job';

const owner = { source: 'chatgpt', conversationKey: 'thread-exact', conversationId: 41 } as const;

describe('image backfill exact message identity', () => {
  it('persists progress updates with the exact messageKey in the incremental diff', async () => {
    const dataImageUrl = `data:image/png;base64,${Buffer.from(Uint8Array.from([2, 7, 1])).toString('base64')}`;
    const syncConversationMessages = vi.fn(async () => ({ upserted: 1, deleted: 0 }));
    const repository = {
      getConversationDetail: vi.fn(async () => ({
        conversationId: owner.conversationId,
        messages: [
          {
            messageKey: ' m1 ',
            role: 'assistant',
            sequence: 1,
            contentMarkdown: `![](${dataImageUrl})`,
          },
        ],
      })),
      syncConversationMessages,
    };
    const imageStorage = {
      findAssetByUrl: vi.fn(async () => null),
      putAsset: vi.fn(async (input: { byteSize: number; contentType: string }) => ({
        id: 7,
        byteSize: input.byteSize,
        contentType: input.contentType,
      })),
    };
    const onProgress = vi.fn();

    await backfillConversationImages({ imageStorage: imageStorage as any, owner, repository: repository as any, onProgress });

    expect(syncConversationMessages).toHaveBeenCalledTimes(1);
    expect(syncConversationMessages).toHaveBeenCalledWith(
      owner,
      [expect.objectContaining({ messageKey: ' m1 ' })],
      { mode: 'incremental', diff: { added: [], updated: [' m1 '], removed: [] } },
    );
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ latestMessageKey: ' m1 ' }));
  });
});
