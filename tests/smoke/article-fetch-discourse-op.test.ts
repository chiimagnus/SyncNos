import { afterEach, describe, expect, it, vi } from 'vitest';

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

async function loadArticleFetchModule() {
  return await import('../../src/collectors/web/article-fetch.ts');
}

function persistence() {
  return {
    findConversation: persistenceMocks.findConversation,
    saveSnapshot: persistenceMocks.saveSnapshot,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  persistenceMocks.findConversation.mockReset();
  persistenceMocks.saveSnapshot.mockReset();
  settingsMocks.storageGet.mockReset();
  settingsMocks.storageSet.mockReset();
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe('article-fetch discourse OP', () => {
  it('keeps topic canonical url and OP content after /20 -> /1 fallback', async () => {
    persistenceMocks.saveSnapshot.mockResolvedValue({ conversationId: 51, isNew: true });
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
    const data = await mod.fetchActiveTabArticle({ persistence: persistence() });

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
  });

  it('resolveOrCapture reuses existing topic-level conversation key from non-OP floor url', async () => {
    persistenceMocks.findConversation.mockResolvedValue({
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
    const data = await mod.resolveOrCaptureActiveTabArticle({ persistence: persistence() });

    expect(persistenceMocks.findConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'web',
        conversationKey: 'article:https://linux.do/t/topic/1870532',
      }),
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
