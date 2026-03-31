import { afterEach, describe, expect, it, vi } from 'vitest';

const storageMocks = {
  hasConversation: vi.fn(),
  upsertConversation: vi.fn(),
  syncConversationMessages: vi.fn(),
};

const settingsMocks = {
  storageGet: vi.fn(),
};

const imageInlineMocks = {
  inlineChatImagesInMessages: vi.fn(),
};

vi.mock('@services/url-cleaning/tracking-param-cleaner', () => ({
  cleanTrackingParamsUrl: async (url: string) => url,
}));

vi.mock('@services/conversations/data/storage', () => ({
  hasConversation: storageMocks.hasConversation,
  upsertConversation: storageMocks.upsertConversation,
  syncConversationMessages: storageMocks.syncConversationMessages,
}));

vi.mock('@platform/storage/local', () => ({
  storageGet: settingsMocks.storageGet,
}));

vi.mock('@services/conversations/data/image-inline', () => ({
  inlineChatImagesInMessages: imageInlineMocks.inlineChatImagesInMessages,
}));

async function loadArticleFetchService() {
  const module = await import('../../src/collectors/web/article-fetch-service.ts');
  return module.default || module;
}

afterEach(() => {
  vi.restoreAllMocks();
  storageMocks.hasConversation.mockReset();
  storageMocks.upsertConversation.mockReset();
  storageMocks.syncConversationMessages.mockReset();
  settingsMocks.storageGet.mockReset();
  imageInlineMocks.inlineChatImagesInMessages.mockReset();
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe('article-fetch-service', () => {
  it('stores extracted active-tab article into conversations/messages', async () => {
    const upsertConversation = vi.fn(async (payload: any) => ({ id: 11, ...payload }));
    const syncConversationMessages = vi.fn(async () => ({ upserted: 1, deleted: 0 }));
    storageMocks.hasConversation.mockResolvedValue(false);
    storageMocks.upsertConversation.mockImplementation(upsertConversation);
    storageMocks.syncConversationMessages.mockImplementation(syncConversationMessages);
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: true });
    imageInlineMocks.inlineChatImagesInMessages.mockImplementation(async (input: any) => ({
      messages: (Array.isArray(input?.messages) ? input.messages : []).map((message: any) => ({
        ...message,
        contentMarkdown: String(message?.contentMarkdown || '').replace(
          'https://example.com/a.png',
          'syncnos-asset://conversation/11/a.png',
        ),
      })),
      inlinedCount: 1,
      downloadedCount: 1,
      fromCacheCount: 0,
      inlinedBytes: 123,
      warningFlags: [],
    }));

    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      if (Array.isArray(details?.files)) {
        cb([{}]);
        return;
      }
      cb([
        {
          result: {
            ok: true,
            title: 'Readability Title',
            author: 'Author',
            publishedAt: '2026-02-20T10:00:00.000Z',
            excerpt: 'Description',
            contentHTML: '<html><body><p>Hello world article text.</p></body></html>',
            contentMarkdown: [
              '## Heading',
              '',
              '![img](https://example.com/a.png)',
              '',
              'Hello world article text.',
            ].join('\n'),
            textContent: 'Hello world article text.',
            warningFlags: [],
          },
        },
      ]);
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 77, url: 'https://example.com/post#frag', title: 'Fallback Title' }]),
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    const data = await service.fetchActiveTabArticle();

    expect(data.conversationId).toBe(11);
    expect(data.url).toBe('https://example.com/post');
    expect(data.title).toBe('Readability Title');
    expect(data.wordCount).toBeGreaterThan(0);

    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(upsertConversation).toHaveBeenCalledTimes(1);
    expect(upsertConversation.mock.calls[0][0]).toMatchObject({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      title: 'Readability Title',
      url: 'https://example.com/post',
      author: 'Author',
    });

    expect(syncConversationMessages).toHaveBeenCalledTimes(1);
    const [conversationId, messages] = syncConversationMessages.mock.calls[0];
    expect(conversationId).toBe(11);
    expect(imageInlineMocks.inlineChatImagesInMessages).toHaveBeenCalledTimes(1);
    expect(imageInlineMocks.inlineChatImagesInMessages.mock.calls[0][0]).toMatchObject({
      conversationId: 11,
      conversationUrl: 'https://example.com/post',
      enableHttpImages: true,
    });
    expect(Array.isArray(messages)).toBe(true);
    expect(messages[0]).toMatchObject({
      messageKey: 'article_body',
      role: 'article',
      sequence: 1,
      contentText: 'Hello world article text.',
      contentMarkdown: '## Heading\n\n![img](syncnos-asset://conversation/11/a.png)\n\nHello world article text.',
    });
  });

  it('does not inline article images when web article cache toggle is disabled', async () => {
    const upsertConversation = vi.fn(async (payload: any) => ({ id: 21, ...payload }));
    const syncConversationMessages = vi.fn(async () => ({ upserted: 1, deleted: 0 }));
    storageMocks.hasConversation.mockResolvedValue(false);
    storageMocks.upsertConversation.mockImplementation(upsertConversation);
    storageMocks.syncConversationMessages.mockImplementation(syncConversationMessages);
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: false });

    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      if (Array.isArray(details?.files)) {
        cb([{}]);
        return;
      }
      cb([
        {
          result: {
            ok: true,
            title: 'No Inline Title',
            author: 'Author',
            publishedAt: '',
            excerpt: '',
            contentHTML: '<html><body><p>Article body.</p></body></html>',
            contentMarkdown: '![img](https://example.com/no-inline.png)\n\nArticle body.',
            textContent: 'Article body.',
            warningFlags: [],
          },
        },
      ]);
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 88, url: 'https://example.com/no-inline#hash', title: 'No Inline Fallback' }]),
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    const data = await service.fetchActiveTabArticle();

    expect(data.conversationId).toBe(21);
    expect(imageInlineMocks.inlineChatImagesInMessages).not.toHaveBeenCalled();
    expect(syncConversationMessages).toHaveBeenCalledTimes(1);
    const [_conversationId, messages] = syncConversationMessages.mock.calls[0];
    expect(messages[0]).toMatchObject({
      contentMarkdown: '![img](https://example.com/no-inline.png)\n\nArticle body.',
    });
  });

  it('rejects non-http active tab url', async () => {
    storageMocks.upsertConversation.mockResolvedValue({ id: 1 });
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: true });

    const executeScript = vi.fn((_details: any, cb: (results: any[]) => void) => cb([{}]));

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 7, url: 'chrome://extensions/', title: 'Extensions' }]),
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    await expect(service.fetchActiveTabArticle()).rejects.toThrow('active tab must be an http(s) page');
    expect(executeScript).not.toHaveBeenCalled();
    expect(imageInlineMocks.inlineChatImagesInMessages).not.toHaveBeenCalled();
  });

  it('fails when storage module is unavailable', async () => {
    storageMocks.upsertConversation.mockRejectedValue(new Error('storage module missing'));
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: true });

    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      if (Array.isArray(details?.files)) {
        cb([{}]);
        return;
      }
      cb([
        {
          result: {
            ok: true,
            title: 'T',
            author: '',
            publishedAt: '',
            excerpt: '',
            contentHTML: '<html><body><p>content</p></body></html>',
            textContent: 'content',
            warningFlags: [],
          },
        },
      ]);
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) => cb([{ id: 9, url: 'https://example.com/a', title: 'A' }]),
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    await expect(service.fetchActiveTabArticle()).rejects.toThrow('storage module missing');
  });
});
