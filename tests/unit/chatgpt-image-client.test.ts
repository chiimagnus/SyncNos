import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@platform/runtime/runtime', () => ({
  send: runtimeMocks.send,
}));

import { resolveChatgptImageUrlsForConversation } from '@services/integrations/chatgpt/image-client';

describe('chatgpt image client', () => {
  beforeEach(() => {
    runtimeMocks.send.mockReset();
  });

  it('dedupes and resolves image ids in bounded sequential batches', async () => {
    const fileIds = Array.from({ length: 35 }, (_, index) => `file_${index + 1}`);
    runtimeMocks.send.mockImplementation(async (_type: string, payload: any) => ({
      ok: true,
      data: payload.fileIds.map((fileId: string) => ({
        fileId,
        ok: true,
        url: `https://files.example/${fileId}`,
      })),
    }));

    const resolved = await resolveChatgptImageUrlsForConversation({
      conversationId: 7,
      fileIds: [...fileIds, fileIds[0]],
    });

    expect(runtimeMocks.send).toHaveBeenCalledTimes(3);
    expect(runtimeMocks.send.mock.calls.map((call) => call[1].fileIds.length)).toEqual([16, 16, 3]);
    expect(runtimeMocks.send.mock.calls.flatMap((call) => call[1].fileIds)).toEqual(fileIds);
    expect(resolved.size).toBe(35);
    expect(resolved.get('file_35')).toBe('https://files.example/file_35');
  });

  it('keeps successful batches when an intermediate runtime request fails', async () => {
    runtimeMocks.send
      .mockResolvedValueOnce({
        ok: true,
        data: [{ fileId: 'file_1', ok: true, url: 'https://files.example/file_1' }],
      })
      .mockRejectedValueOnce(new Error('runtime.sendMessage timed out after 60000ms'))
      .mockResolvedValueOnce({
        ok: true,
        data: [{ fileId: 'file_33', ok: true, url: 'https://files.example/file_33' }],
      });

    const resolved = await resolveChatgptImageUrlsForConversation({
      conversationId: 8,
      fileIds: Array.from({ length: 33 }, (_, index) => `file_${index + 1}`),
    });

    expect(runtimeMocks.send).toHaveBeenCalledTimes(3);
    expect(resolved).toEqual(
      new Map([
        ['file_1', 'https://files.example/file_1'],
        ['file_33', 'https://files.example/file_33'],
      ]),
    );
  });
});
