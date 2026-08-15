import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const persistenceMocks = {
  findConversation: vi.fn(),
  saveSnapshot: vi.fn(),
};

const settingsMocks = {
  storageGet: vi.fn(),
  storageSet: vi.fn(),
};

vi.mock('@platform/storage/local', () => ({
  storageGet: settingsMocks.storageGet,
  storageSet: settingsMocks.storageSet,
}));

async function loadArticleFetchService() {
  const module = await import('../../src/collectors/web/article-fetch-service.ts');
  const api = module.default || module;
  return {
    ...api,
    fetchActiveTabArticle: async (input: { tabId?: number } = {}) =>
      await api.fetchActiveTabArticle({
        ...input,
        persistence: {
          findConversation: persistenceMocks.findConversation,
          saveSnapshot: persistenceMocks.saveSnapshot,
        },
      }),
  };
}

beforeEach(() => {
  vi.resetModules();
  settingsMocks.storageSet.mockResolvedValue(undefined);
  persistenceMocks.findConversation.mockResolvedValue(null);
  persistenceMocks.saveSnapshot.mockResolvedValue({ conversationId: 1, isNew: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  persistenceMocks.findConversation.mockReset();
  persistenceMocks.saveSnapshot.mockReset();
  settingsMocks.storageGet.mockReset();
  settingsMocks.storageSet.mockReset();
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe('article-fetch-service', () => {
  it('passes the extracted active-tab article as one snapshot', async () => {
    persistenceMocks.saveSnapshot.mockResolvedValue({ conversationId: 11, isNew: true });
    settingsMocks.storageGet.mockImplementation(async (keys: string[]) => {
      if (keys.includes('xiaohongshu_comments_capture_enabled')) {
        return { xiaohongshu_comments_capture_enabled: true };
      }
      return { web_article_cache_images_enabled: true };
    });
    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      cb(Array.isArray(details?.files) ? [{}] : []);
    });

    const sendMessage = vi.fn((_tabId: number, _msg: any, cb: (res: any) => void) => {
      cb({
        ok: true,
        data: {
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
      });
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 77, url: 'https://example.com/post#frag', title: 'Fallback Title' }]),
        sendMessage,
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

    expect(sendMessage.mock.calls[0][1]).toMatchObject({
      payload: { includeXiaohongshuComments: true },
    });

    expect(executeScript).toHaveBeenCalledTimes(0);
    expect(persistenceMocks.saveSnapshot).toHaveBeenCalledTimes(1);
    const [[{ snapshot, forceHttpImageCache }]] = persistenceMocks.saveSnapshot.mock.calls;
    expect(forceHttpImageCache).toBe(false);
    expect(snapshot.conversation).toMatchObject({
      sourceType: 'article',
      source: 'web',
      conversationKey: 'article:https://example.com/post',
      title: 'Readability Title',
      url: 'https://example.com/post',
      author: 'Author',
    });

    expect(snapshot.messages[0]).toMatchObject({
      messageKey: 'article_body',
      role: 'article',
      sequence: 1,
      contentText: 'Hello world article text.',
      contentMarkdown: '## Heading\n\n![img](https://example.com/a.png)\n\nHello world article text.',
    });
  });

  it('navigates discourse topic to /1 when current floor misses OP and keeps topic-level canonical url', async () => {
    persistenceMocks.saveSnapshot.mockResolvedValue({ conversationId: 31, isNew: true });
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: false });

    let currentUrl = 'https://linux.do/t/topic/1870532/xxx?u=abc#reply-2';
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
      const base = String(updateProps?.url || currentUrl);
      currentUrl = `${base}?u=abc#reply-1`;
      cb({ id: tabId, url: currentUrl, title: 'Topic tab' });
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) => cb([{ id: 77, url: currentUrl, title: 'Topic tab' }]),
        get: tabsGet,
        update: tabsUpdate,
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    const data = await service.fetchActiveTabArticle();

    expect(tabsUpdate).toHaveBeenCalledTimes(1);
    expect(tabsUpdate.mock.calls[0][1]).toMatchObject({
      url: 'https://linux.do/t/topic/1870532/1',
    });
    expect(data.url).toBe('https://linux.do/t/topic/1870532');

    expect(persistenceMocks.saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          conversation: expect.objectContaining({
            conversationKey: 'article:https://linux.do/t/topic/1870532',
            url: 'https://linux.do/t/topic/1870532',
          }),
        }),
      }),
    );

    expect(persistenceMocks.saveSnapshot.mock.calls[0][0].snapshot.messages[0]).toMatchObject({
      contentText: 'OP body',
      contentMarkdown: 'OP body',
    });
    expect(currentUrl).toBe('https://linux.do/t/topic/1870532/1?u=abc#reply-1');
  });

  it('does not navigate to /1 when OP is already extractable on a high discourse floor', async () => {
    persistenceMocks.saveSnapshot.mockResolvedValue({ conversationId: 33, isNew: true });
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: false });

    const currentUrl = 'https://linux.do/t/topic/1870532/820?u=abc#reply-9';
    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      cb(Array.isArray(details?.files) ? [{}] : []);
    });

    const sendMessage = vi.fn((_tabId: number, _msg: any, cb: (res: any) => void) => {
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

    const tabsUpdate = vi.fn();

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) => cb([{ id: 77, url: currentUrl, title: 'Topic tab' }]),
        update: tabsUpdate,
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    const data = await service.fetchActiveTabArticle();

    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(data.url).toBe('https://linux.do/t/topic/1870532');
    expect(persistenceMocks.saveSnapshot.mock.calls[0][0].snapshot.messages[0]).toMatchObject({
      contentText: 'OP body',
      contentMarkdown: 'OP body',
    });
  });

  it('fails strictly when discourse OP is still missing on /1', async () => {
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: false });

    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      cb(Array.isArray(details?.files) ? [{}] : []);
    });

    const sendMessage = vi.fn((_tabId: number, _msg: any, cb: (res: any) => void) => {
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
    });

    const tabsUpdate = vi.fn();

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 77, url: 'https://linux.do/t/topic/1870532/1', title: 'Topic tab' }]),
        update: tabsUpdate,
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    await expect(service.fetchActiveTabArticle()).rejects.toThrow('Discourse OP not found');

    expect(persistenceMocks.saveSnapshot).not.toHaveBeenCalled();
    expect(tabsUpdate).not.toHaveBeenCalled();
  });

  it('does not force image cache when no anti-hotlink rule matches', async () => {
    persistenceMocks.saveSnapshot.mockResolvedValue({ conversationId: 21, isNew: true });
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: false });

    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      cb(Array.isArray(details?.files) ? [{}] : []);
    });

    const sendMessage = vi.fn((_tabId: number, _msg: any, cb: (res: any) => void) => {
      cb({
        ok: true,
        data: {
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
      });
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 88, url: 'https://example.com/no-inline#hash', title: 'No Inline Fallback' }]),
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    const data = await service.fetchActiveTabArticle();

    expect(data.conversationId).toBe(21);
    expect(persistenceMocks.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ forceHttpImageCache: false }));
    expect(persistenceMocks.saveSnapshot.mock.calls[0][0].snapshot.messages[0]).toMatchObject({
      contentMarkdown: '![img](https://example.com/no-inline.png)\n\nArticle body.',
    });
  });

  it('forces image cache for anti-hotlink article images even when toggle is disabled', async () => {
    persistenceMocks.saveSnapshot.mockResolvedValue({ conversationId: 71, isNew: true });
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: false });

    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      cb(Array.isArray(details?.files) ? [{}] : []);
    });

    const sendMessage = vi.fn((_tabId: number, _msg: any, cb: (res: any) => void) => {
      cb({
        ok: true,
        data: {
          ok: true,
          title: 'Anti-hotlink Title',
          author: 'Author',
          publishedAt: '',
          excerpt: '',
          contentHTML: '<html><body><p>Article body.</p></body></html>',
          contentMarkdown: '![img](https://cdnfile.sspai.com/asset/a.png)\n\nArticle body.',
          textContent: 'Article body.',
          warningFlags: [],
        },
      });
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 91, url: 'https://sspai.com/post/1', title: 'Anti-hotlink fallback' }]),
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    const data = await service.fetchActiveTabArticle();

    expect(data.conversationId).toBe(71);
    expect(persistenceMocks.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ forceHttpImageCache: true }));
    expect(settingsMocks.storageSet).toHaveBeenCalledWith(
      expect.objectContaining({
        anti_hotlink_rules_v1: expect.arrayContaining([
          expect.objectContaining({ domain: 'cdnfile.sspai.com', referer: 'https://sspai.com/' }),
        ]),
      }),
    );
  });

  it('keeps capture successful when anti-hotlink rule lookup fails', async () => {
    persistenceMocks.saveSnapshot.mockResolvedValue({ conversationId: 72, isNew: true });
    settingsMocks.storageGet.mockImplementation(async (keys: string[]) => {
      if (Array.isArray(keys) && keys.includes('web_article_cache_images_enabled')) {
        return { web_article_cache_images_enabled: false };
      }
      throw new Error('anti-hotlink rules read failed');
    });

    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      cb(Array.isArray(details?.files) ? [{}] : []);
    });

    const sendMessage = vi.fn((_tabId: number, _msg: any, cb: (res: any) => void) => {
      cb({
        ok: true,
        data: {
          ok: true,
          title: 'Fallback Capture Title',
          author: 'Author',
          publishedAt: '',
          excerpt: '',
          contentHTML: '<html><body><p>Article body.</p></body></html>',
          contentMarkdown: '![img](https://cdnfile.sspai.com/asset/a.png)\n\nArticle body.',
          textContent: 'Article body.',
          warningFlags: [],
        },
      });
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 92, url: 'https://sspai.com/post/2', title: 'Fallback Capture' }]),
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    const data = await service.fetchActiveTabArticle();

    expect(data.conversationId).toBe(72);
    expect(persistenceMocks.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ forceHttpImageCache: false }));
  });

  it('does not force inline when anti-hotlink rules are explicitly empty', async () => {
    persistenceMocks.saveSnapshot.mockResolvedValue({ conversationId: 73, isNew: true });
    settingsMocks.storageGet.mockImplementation(async (keys: string[]) => {
      if (Array.isArray(keys) && keys.includes('web_article_cache_images_enabled')) {
        return { web_article_cache_images_enabled: false };
      }
      if (Array.isArray(keys) && keys.includes('anti_hotlink_rules_v1')) {
        return { anti_hotlink_rules_v1: [] };
      }
      return {};
    });

    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      cb(Array.isArray(details?.files) ? [{}] : []);
    });

    const sendMessage = vi.fn((_tabId: number, _msg: any, cb: (res: any) => void) => {
      cb({
        ok: true,
        data: {
          ok: true,
          title: 'No Force Cache',
          author: 'Author',
          publishedAt: '',
          excerpt: '',
          contentHTML: '<html><body><p>Article body.</p></body></html>',
          contentMarkdown: '![img](https://cdnfile.sspai.com/asset/a.png)\n\nArticle body.',
          textContent: 'Article body.',
          warningFlags: [],
        },
      });
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 93, url: 'https://sspai.com/post/3', title: 'No Force Cache' }]),
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    const data = await service.fetchActiveTabArticle();

    expect(data.conversationId).toBe(73);
    expect(persistenceMocks.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ forceHttpImageCache: false }));
  });

  it('rejects non-http active tab url', async () => {
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
    expect(persistenceMocks.saveSnapshot).not.toHaveBeenCalled();
  });

  it('fails when snapshot persistence rejects', async () => {
    persistenceMocks.saveSnapshot.mockRejectedValue(new Error('snapshot persistence failed'));
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: true });

    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) => {
      cb(Array.isArray(details?.files) ? [{}] : []);
    });

    const sendMessage = vi.fn((_tabId: number, _msg: any, cb: (res: any) => void) => {
      cb({
        ok: true,
        data: {
          ok: true,
          title: 'T',
          author: '',
          publishedAt: '',
          excerpt: '',
          contentHTML: '<html><body><p>content</p></body></html>',
          contentMarkdown: 'content',
          textContent: 'content',
          warningFlags: [],
        },
      });
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: { lastError: null },
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) => cb([{ id: 9, url: 'https://example.com/a', title: 'A' }]),
        sendMessage,
      },
      scripting: {
        executeScript,
      },
    };

    const service = await loadArticleFetchService();
    await expect(service.fetchActiveTabArticle()).rejects.toThrow('snapshot persistence failed');
  });

  it('retries extract message once when content script is not ready yet', async () => {
    vi.useFakeTimers();

    persistenceMocks.saveSnapshot.mockResolvedValue({ conversationId: 51, isNew: true });
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: false });

    const runtime = { lastError: null as any };
    const executeScript = vi.fn((details: any, cb: (results: any[]) => void) =>
      cb(Array.isArray(details?.files) ? [{}] : []),
    );

    let messageCalls = 0;
    const sendMessage = vi.fn((_tabId: number, _msg: any, cb: (res: any) => void) => {
      messageCalls += 1;
      if (messageCalls === 1) {
        runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
        cb(null);
        runtime.lastError = null;
        return;
      }
      cb({
        ok: true,
        data: {
          ok: true,
          title: 'Retry Title',
          author: '',
          publishedAt: '',
          excerpt: '',
          contentHTML: '<html><body><p>content</p></body></html>',
          contentMarkdown: 'content',
          textContent: 'content',
          warningFlags: [],
        },
      });
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime,
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 77, url: 'https://example.com/retry', title: 'T' }]),
        sendMessage,
      },
      scripting: { executeScript },
    };

    const service = await loadArticleFetchService();
    const pending = service.fetchActiveTabArticle();

    await vi.advanceTimersByTimeAsync(1_000);
    const data = await pending;

    expect(data.title).toBe('Retry Title');
    expect(sendMessage).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('continues capture when readability injection fails', async () => {
    persistenceMocks.saveSnapshot.mockResolvedValue({ conversationId: 61, isNew: true });
    settingsMocks.storageGet.mockResolvedValue({ web_article_cache_images_enabled: false });

    const runtime = { lastError: null as any };
    const executeScript = vi.fn((_details: any, cb: (results: any[]) => void) => {
      runtime.lastError = { message: 'executeScript blocked by page policy' };
      cb([]);
      runtime.lastError = null;
    });

    let extractCall = 0;
    const sendMessage = vi.fn((_tabId: number, _msg: any, cb: (res: any) => void) => {
      extractCall += 1;
      if (extractCall === 1) {
        cb({ ok: false, error: { message: 'No article content detected' } });
        return;
      }
      cb({
        ok: true,
        data: {
          ok: true,
          title: 'No Readability Title',
          author: '',
          publishedAt: '',
          excerpt: '',
          contentHTML: '<html><body><p>content</p></body></html>',
          contentMarkdown: 'content',
          textContent: 'content',
          warningFlags: [],
        },
      });
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime,
      tabs: {
        query: (_query: any, cb: (tabs: any[]) => void) =>
          cb([{ id: 77, url: 'https://example.com/noread', title: 'T' }]),
        sendMessage,
      },
      scripting: { executeScript },
    };

    const service = await loadArticleFetchService();
    const data = await service.fetchActiveTabArticle();

    expect(data.title).toBe('No Readability Title');
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
