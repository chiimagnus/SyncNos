import { describe, expect, it, vi } from 'vitest';

import { resolveChatWithSyncedUrlsFromRuntime } from '../../src/services/integrations/chatwith/chatwith-synced-urls-client';

describe('resolveChatWithSyncedUrlsFromRuntime', () => {
  it('requests synced URLs by conversation id and normalizes the response', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        notionUrl: ' https://www.notion.so/example ',
        feishuUrl: ' https://www.feishu.cn/docx/example ',
        githubUrl: ' https://github.com/owner/repo/blob/main/WebArticles/example.md ',
      },
    });

    await expect(resolveChatWithSyncedUrlsFromRuntime({ send }, 7)).resolves.toEqual({
      notionUrl: 'https://www.notion.so/example',
      feishuUrl: 'https://www.feishu.cn/docx/example',
      githubUrl: 'https://github.com/owner/repo/blob/main/WebArticles/example.md',
    });
    expect(send).toHaveBeenCalledWith('chatwithResolveSyncedUrls', { conversationId: 7 });
  });

  it('returns an empty result without messaging for an invalid conversation id', async () => {
    const send = vi.fn();

    await expect(resolveChatWithSyncedUrlsFromRuntime({ send }, 0)).resolves.toEqual({});
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed when the background route is unavailable', async () => {
    const send = vi.fn().mockRejectedValue(new Error('runtime unavailable'));

    await expect(resolveChatWithSyncedUrlsFromRuntime({ send }, 7)).resolves.toEqual({});
  });
});
