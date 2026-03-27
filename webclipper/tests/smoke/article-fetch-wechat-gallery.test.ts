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

describe('article-fetch wechat gallery markdown', () => {
  it('appends wechat share media as image blocks instead of markdown table', async () => {
    const dom = new JSDOM(
      `<body>
        <div id="js_content"><p>正文段落</p></div>
        <div class="share_content_page"></div>
        <div id="img_swiper_content"></div>
        <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/a/640?wx_fmt=jpeg&tp=webp&wxfrom=5" /></div>
        <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/b/640?from=singlemessage&wxfrom=5" /></div>
        <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/c/640?wxfrom=5" /></div>
        <div class="swiper_item_img"><img data-src="https://mmbiz.qpic.cn/img/d/640?usePicPrefetch=1&wxfrom=5" /></div>
      </body>`,
      {
        url: 'https://mp.weixin.qq.com/s/abc123',
        pretendToBeVisual: true,
      },
    );

    const readability = class {
      _doc: Document;
      constructor(doc: Document) {
        this._doc = doc;
      }
      parse() {
        const root = this._doc.querySelector('#js_content');
        return {
          title: '微信文章',
          byline: '',
          content: root ? root.innerHTML : '',
          textContent: root ? root.textContent || '' : '',
          excerpt: '',
        };
      }
    };

    tabsMocks.tabsQuery.mockResolvedValue([
      { id: 88, url: 'https://mp.weixin.qq.com/s/abc123', title: 'WeChat Article' },
    ]);
    storageMocks.hasConversation.mockResolvedValue(false);
    storageMocks.upsertConversation.mockResolvedValue({ id: 5 });
    storageMocks.syncConversationMessages.mockResolvedValue({ upserted: 1, deleted: 0 });

    scriptingMocks.scriptingExecuteScript.mockImplementation(async (details: any) => {
      if (Array.isArray(details?.files)) return [{}];
      const arg = { ...(details?.args?.[0] || {}), stabilizationTimeoutMs: 1200, stabilizationMinTextLength: 1 };
      setDomGlobals(dom);
      // @ts-expect-error test global
      globalThis.Readability = readability;
      const result = await details.func(arg);
      return [{ result }];
    });

    const articleFetch = await loadArticleFetchModule();
    await articleFetch.fetchActiveTabArticle();

    expect(storageMocks.syncConversationMessages).toHaveBeenCalledTimes(1);
    const messages = storageMocks.syncConversationMessages.mock.calls[0][1];
    expect(Array.isArray(messages)).toBe(true);
    const markdown = String(messages[0]?.contentMarkdown || '');

    expect(markdown).toContain('![](<https://mmbiz.qpic.cn/img/a/640?wx_fmt=jpeg>)');
    expect(markdown).toContain('![](<https://mmbiz.qpic.cn/img/b/640>)');
    expect(markdown).toContain('![](<https://mmbiz.qpic.cn/img/c/640>)');
    expect(markdown).toContain('![](<https://mmbiz.qpic.cn/img/d/640>)');
    expect(markdown).not.toContain('| --- |');
    expect(markdown).not.toContain('| ![](');
  });
});
