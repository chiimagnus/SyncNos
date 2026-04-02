import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const storageMocks = {
  getConversationBySourceConversationKey: vi.fn(),
  hasConversation: vi.fn(),
  upsertConversation: vi.fn(),
  syncConversationMessages: vi.fn(),
};

const tabsMocks = {
  tabsGet: vi.fn(),
  tabsQuery: vi.fn(),
};

const scriptingMocks = {
  scriptingExecuteScript: vi.fn(),
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

vi.mock('@platform/webext/tabs', () => ({
  tabsGet: tabsMocks.tabsGet,
  tabsQuery: tabsMocks.tabsQuery,
}));

vi.mock('@platform/webext/scripting', () => ({
  scriptingExecuteScript: scriptingMocks.scriptingExecuteScript,
}));

async function loadArticleFetchModule() {
  const mod = await import(
    /* @vite-ignore */ `../../src/collectors/web/article-fetch.ts?t=${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
  return mod;
}

function setDomGlobals(dom: JSDOM) {
  // @ts-expect-error test global
  globalThis.window = dom.window;
  // @ts-expect-error test global
  globalThis.document = dom.window.document;
  // @ts-expect-error test global
  globalThis.Node = dom.window.Node;
  // @ts-expect-error test global
  globalThis.location = dom.window.location;
  // @ts-expect-error test global
  globalThis.getComputedStyle = dom.window.getComputedStyle;
}

function clearDomGlobals() {
  // @ts-expect-error test global
  delete globalThis.window;
  // @ts-expect-error test global
  delete globalThis.document;
  // @ts-expect-error test global
  delete globalThis.Node;
  // @ts-expect-error test global
  delete globalThis.location;
  // @ts-expect-error test global
  delete globalThis.getComputedStyle;
  // @ts-expect-error test global
  delete globalThis.Readability;
}

afterEach(() => {
  vi.restoreAllMocks();
  storageMocks.getConversationBySourceConversationKey.mockReset();
  storageMocks.hasConversation.mockReset();
  storageMocks.upsertConversation.mockReset();
  storageMocks.syncConversationMessages.mockReset();
  tabsMocks.tabsGet.mockReset();
  tabsMocks.tabsQuery.mockReset();
  scriptingMocks.scriptingExecuteScript.mockReset();
  clearDomGlobals();
});

describe('article-fetch bilibili opus', () => {
  it('extracts images + text and strips bilibili @ image suffix', async () => {
    const dom = new JSDOM(
      `<body>
        <div class="bili-opus-view">
          <div class="opus-module-top">
            <div class="opus-module-top__album">
              <div class="horizontal-scroll-album__pic__img">
                <img src="//i0.hdslb.com/bfs/new_dyn/a.jpg@858w_1044h.webp" />
              </div>
              <div class="horizontal-scroll-album__pic__img">
                <img src="//i0.hdslb.com/bfs/new_dyn/b.jpg@858w_1044h.webp" />
              </div>
            </div>
          </div>
          <div class="opus-module-title"><span class="opus-module-title__text">标题</span></div>
          <div class="opus-module-author">
            <div class="opus-module-author__name">作者</div>
            <div class="opus-module-author__pub__text">2026年04月01日 09:21</div>
          </div>
          <div class="opus-module-content"><p>正文段落</p></div>
        </div>
      </body>`,
      { url: 'https://www.bilibili.com/opus/123', pretendToBeVisual: true },
    );

    tabsMocks.tabsQuery.mockResolvedValue([{ id: 88, url: 'https://www.bilibili.com/opus/123', title: 'bili' }]);
    storageMocks.hasConversation.mockResolvedValue(false);
    storageMocks.upsertConversation.mockResolvedValue({ id: 5 });
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });

    scriptingMocks.scriptingExecuteScript.mockImplementation(async (details: any) => {
      if (Array.isArray(details?.files)) return [{}];
      const arg = { ...(details?.args?.[0] || {}), stabilizationTimeoutMs: 1, stabilizationMinTextLength: 1 };
      setDomGlobals(dom);
      const result = await details.func(arg);
      return [{ result }];
    });

    const articleFetch = await loadArticleFetchModule();
    await articleFetch.fetchActiveTabArticle();

    expect(storageMocks.syncConversationMessages).toHaveBeenCalledTimes(1);
    const messages = storageMocks.syncConversationMessages.mock.calls[0][1];
    const markdown = String(messages[0]?.contentMarkdown || '');

    expect(markdown).toContain('![](<https://i0.hdslb.com/bfs/new_dyn/a.jpg>)');
    expect(markdown).toContain('![](<https://i0.hdslb.com/bfs/new_dyn/b.jpg>)');
    expect(markdown).toContain('正文段落');
  });
});

