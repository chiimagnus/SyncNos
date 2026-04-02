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

describe('article-fetch xhs note', () => {
  it('extracts images + desc and strips xhs ! image suffix', async () => {
    const dom = new JSDOM(
      `<head>
        <meta property="og:title" content="小红书笔记标题" />
      </head>
      <body>
        <div id="noteContainer" class="note-container">
          <div class="author"><span class="username">小作者</span></div>
          <div class="media-container">
            <img src="https://sns-webpic-qc.xhscdn.com/path/one!nd_dft_wlteh_webp_3" />
            <img src="https://sns-webpic-qc.xhscdn.com/path/one!nd_dft_wlteh_webp_3" />
            <img src="https://sns-webpic-qc.xhscdn.com/path/two!nc_n_webp_mw_1" />
          </div>
          <div class="note-content">
            <div id="detail-desc" class="desc">
              <span class="note-text">#话题 看我看到了谁👀 @某人</span>
            </div>
            <div class="bottom-container"><span class="date">2天前 湖南</span></div>
          </div>
        </div>
      </body>`,
      { url: 'https://www.xiaohongshu.com/explore/abc', pretendToBeVisual: true },
    );

    tabsMocks.tabsQuery.mockResolvedValue([
      { id: 88, url: 'https://www.xiaohongshu.com/explore/abc', title: 'xhs' },
    ]);
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

    expect(markdown).toContain('![](<https://sns-webpic-qc.xhscdn.com/path/one>)');
    expect(markdown).toContain('![](<https://sns-webpic-qc.xhscdn.com/path/two>)');
    expect(markdown).toContain('#话题 看我看到了谁👀 @某人');
  });
});

