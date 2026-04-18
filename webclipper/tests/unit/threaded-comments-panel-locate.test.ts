import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('@services/comments/locator', async () => {
  const actual = await vi.importActual<typeof import('@services/comments/locator')>('@services/comments/locator');
  return {
    ...actual,
    restoreRangeFromArticleCommentLocator: vi.fn(),
  };
});

import { restoreRangeFromArticleCommentLocator } from '@services/comments/locator';
import { mountThreadedCommentsPanel } from '@ui/comments';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: dom.window.MutationObserver });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).getComputedStyle;
}

async function flushReactScheduler() {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(resolve);
      return;
    }
    setTimeout(resolve, 0);
  });
  await Promise.resolve();
}

describe('Threaded comments panel locate', () => {
  beforeEach(() => {
    setupDom();
    vi.useFakeTimers();
    (restoreRangeFromArticleCommentLocator as any).mockReset?.();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await flushReactScheduler();
    cleanupDom();
  });

  it('locates root comment with locator on click', () => {
    document.body.innerHTML = '<div id="article">Hello world</div>';
    const article = document.getElementById('article') as HTMLElement;
    const textNode = article.firstChild as Text;

    const scrollIntoView = vi.fn();
    (article as any).scrollIntoView = scrollIntoView;

    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);

    (restoreRangeFromArticleCommentLocator as any).mockReturnValue(range);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      variant: 'sidebar',
      locatorEnv: 'inpage',
    });

    mounted.api.setComments([
      {
        id: 1,
        parentId: null,
        createdAt: 1000,
        quoteText: 'world',
        commentText: 'root',
        locator: { env: 'inpage', quote: { exact: 'world' }, position: { start: 1 } },
      },
      {
        id: 2,
        parentId: 1,
        createdAt: 1100,
        commentText: 'reply',
        locator: { env: 'inpage', quote: { exact: 'world' }, position: { start: 1 } },
      },
    ]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const rootComment = shadow.querySelector('.webclipper-inpage-comments-panel__comment') as HTMLElement | null;
    expect(rootComment).toBeTruthy();
    rootComment!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(restoreRangeFromArticleCommentLocator).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(article.getAttribute('data-webclipper-locate-highlight')).toBe('1');

    vi.advanceTimersByTime(1500);
    expect(article.getAttribute('data-webclipper-locate-highlight')).toBe(null);

    const replyBody = shadow.querySelector(
      '.webclipper-inpage-comments-panel__reply > .webclipper-inpage-comments-panel__text',
    ) as HTMLElement | null;
    expect(replyBody).toBeTruthy();
    replyBody!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(restoreRangeFromArticleCommentLocator).toHaveBeenCalledTimes(1);

    mounted.cleanup();
  });

  it('ignores locate clicks when locator root is missing', () => {
    document.body.innerHTML = '<div id="article">Hello world</div>';

    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, {
      overlay: false,
      showHeader: false,
      variant: 'sidebar',
      locatorEnv: 'app',
      getLocatorRoot: () => null,
    });

    mounted.api.setComments([
      {
        id: 1,
        parentId: null,
        createdAt: 1000,
        quoteText: 'world',
        commentText: 'root',
        locator: { env: 'app', quote: { exact: 'world' }, position: { start: 1 } },
      },
    ]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;
    const rootComment = shadow.querySelector('.webclipper-inpage-comments-panel__comment') as HTMLElement | null;
    expect(rootComment).toBeTruthy();

    rootComment!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(restoreRangeFromArticleCommentLocator).not.toHaveBeenCalled();

    mounted.cleanup();
  });
});
