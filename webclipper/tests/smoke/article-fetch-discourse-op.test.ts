import { afterEach, describe, expect, it, vi } from 'vitest';

const storageMocks = {
  getConversationBySourceConversationKey: vi.fn(),
  hasConversation: vi.fn(),
  upsertConversation: vi.fn(),
  syncConversationMessages: vi.fn(),
};

const settingsMocks = {
  storageGet: vi.fn(),
};

vi.mock('@services/url-cleaning/tracking-param-cleaner', () => ({
  cleanTrackingParamsUrl: async (url: string) => url,
}));

vi.mock('@services/conversations/data/storage', () => ({
  getConversationBySourceConversationKey: storageMocks.getConversationBySourceConversationKey,
  hasConversation: storageMocks.hasConversation,
  upsertConversation: storageMocks.upsertConversation,
  syncConversationMessages: storageMocks.syncConversationMessages,
}));

vi.mock('@platform/storage/local', () => ({
  storageGet: settingsMocks.storageGet,
}));

vi.mock('@services/conversations/data/image-inline', () => ({
  inlineChatImagesInMessages: vi.fn(async (input: any) => ({
    messages: Array.isArray(input?.messages) ? input.messages : [],
    inlinedCount: 0,
    downloadedCount: 0,
    fromCacheCount: 0,
    inlinedBytes: 0,
    warningFlags: [],
  })),
}));

async function loadArticleFetchModule() {
  return await import('../../src/collectors/web/article-fetch.ts');
}

afterEach(() => {
  vi.restoreAllMocks();
  storageMocks.getConversationBySourceConversationKey.mockReset();
  storageMocks.hasConversation.mockReset();
  storageMocks.upsertConversation.mockReset();
  storageMocks.syncConversationMessages.mockReset();
  settingsMocks.storageGet.mockReset();
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe('article-fetch discourse OP', () => {
  it('keeps topic canonical url and OP content after /20 -> /1 fallback', async () => {
    storageMocks.hasConversation.mockResolvedValue(false);
    storageMocks.upsertConversation.mockImplementation(async (payload: any) => ({ id: 51, ...payload }));
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: false });

    let currentUrl = 'https://linux.do/t/topic/1870532/820';
    let extractCall = 0;
    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      cb(Array.isArray(details?.files) ? [{}] : []);
    });

    const sendMessage = vi.fn((_tabId: number, _msg: any, cb: (res: any) => void) => {
      extractCall += 1;
      if (extractCall === 1) {
        cb({
          ok: true,
          data: {
            ok: true,
            title: 'Topic Title',
            author: 'Reply Author',
            publishedAt: '',
            excerpt: '',
            contentHTML: '<html><body><p>Reply body</p></body></html>',
            contentMarkdown: 'Reply body',
            textContent: 'Reply body',
            warningFlags: ['discourse_op_missing_on_page'],
          },
        });
        return;
      }

      cb({
        ok: true,
        data: {
          ok: true,
          title: 'Topic Title',
          author: 'Op Author',
          publishedAt: '',
          excerpt: '',
          contentHTML: '<html><body><p>OP body</p></body></html>',
          contentMarkdown: 'OP body',
          textContent: 'OP body',
          warningFlags: [],
        },
      });
    });

    const tabsGet = vi.fn((tabId: number, cb: (tab: any) => void) => {
      cb({ id: tabId, url: currentUrl, title: 'Topic tab' });
    });

    const tabsUpdate = vi.fn((tabId: number, updateProps: any, cb: (tab: any) => void) => {
      currentUrl = String(updateProps?.url || currentUrl);
      cb({ id: tabId, url: currentUrl, title: 'Topic tab' });
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 77, url: 'https://linux.do/t/topic/1870532/820?u=abc#reply-2', title: 'Topic tab' }]),
        get: tabsGet,
        update: tabsUpdate,
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    };

    const mod = await loadArticleFetchModule();
    const data = await mod.fetchActiveTabArticle();

    expect(tabsUpdate).toHaveBeenCalledWith(
      77,
      expect.objectContaining({ url: 'https://linux.do/t/topic/1870532/1' }),
      expect.any(Function),
    );
    expect(data).toMatchObject({
      url: 'https://linux.do/t/topic/1870532',
      title: 'Topic Title',
      author: 'Op Author',
    });
    expect(storageMocks.upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: 'article:https://linux.do/t/topic/1870532',
        url: 'https://linux.do/t/topic/1870532',
      }),
    );
  });

  it('resolveOrCapture reuses existing topic-level conversation key from non-OP floor url', async () => {
    storageMocks.getConversationBySourceConversationKey.mockResolvedValue({
      id: 88,
      title: 'Existing Topic',
      author: 'Author',
      publishedAt: '',
      warningFlags: [],
      lastCapturedAt: 123,
    });

    const executeScript = vi.fn();

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 21, url: 'https://linux.do/t/topic/1870532/820?u=abc#tail', title: 'Topic tab' }]),
      },
      scripting: {
        executeScript,
      },
    };

    const mod = await loadArticleFetchModule();
    const data = await mod.resolveOrCaptureActiveTabArticle();

    expect(storageMocks.getConversationBySourceConversationKey).toHaveBeenCalledWith(
      'web',
      'article:https://linux.do/t/topic/1870532',
    );
    expect(data).toMatchObject({
      isNew: false,
      conversationId: 88,
      url: 'https://linux.do/t/topic/1870532',
      title: 'Existing Topic',
      author: 'Author',
    });
    expect(executeScript).not.toHaveBeenCalled();
  });
});
