import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
}));

import { mountThreadedCommentsPanel } from '@ui/comments';
import { getCommentSidebarPanelTestDriver } from '../helpers/comment-sidebar-panel-driver';

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

describe('Threaded comments panel ordering', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(async () => {
    await flushReactScheduler();
    cleanupDom();
  });

  it('orders root threads by createdAt descending and replies by createdAt ascending', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, { surface: 'inpage' });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, authorName: 'You', quoteText: '', commentText: 'root-old' },
      { id: 2, parentId: null, createdAt: 2000, authorName: 'You', quoteText: '', commentText: 'root-new' },
      { id: 3, parentId: 2, createdAt: 1500, authorName: 'You', quoteText: '', commentText: 'reply-old' },
      { id: 4, parentId: 2, createdAt: 2500, authorName: 'You', quoteText: '', commentText: 'reply-new' },
      { id: 5, parentId: 1, createdAt: 3000, authorName: 'You', quoteText: '', commentText: 'reply-root1-new' },
    ]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel?.shadowRoot;
    expect(shadow).toBeTruthy();

    const threads = Array.from(shadow!.querySelectorAll('.webclipper-inpage-comments-panel__thread'));
    expect(threads.length).toBe(2);

    const rootBodies = threads.map((t) =>
      t
        .querySelector('.webclipper-inpage-comments-panel__comment-main > .webclipper-inpage-comments-panel__markdown')
        ?.textContent?.trim(),
    );
    expect(rootBodies).toEqual(['root-new', 'root-old']);

    const replies = Array.from(
      threads[0].querySelectorAll(
        '.webclipper-inpage-comments-panel__reply-main > .webclipper-inpage-comments-panel__markdown',
      ),
    ).map((x) => x.textContent?.trim());
    expect(replies).toEqual(['reply-old', 'reply-new']);

    mounted.cleanup();
  });

  it('renders an attributed quote root without an empty root-comment row', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, { surface: 'inpage' });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      {
        id: 20,
        parentId: null,
        createdAt: 1000,
        authorName: 'Chii',
        quoteText: 'quoted root',
        commentText: '',
        importSource: 'dedao',
        importKey: 'quote-20',
      },
      { id: 21, parentId: 20, createdAt: 1001, authorName: 'Chii', quoteText: '', commentText: 'comment child' },
    ]);

    const shadow = host.querySelector('webclipper-threaded-comments-panel')?.shadowRoot;
    const thread = shadow!.querySelector('[data-thread-root-id="20"]') as HTMLElement;
    expect(thread.querySelector('.webclipper-inpage-comments-panel__thread-quote')?.textContent).toContain('Chii');
    expect(thread.querySelector('.webclipper-inpage-comments-panel__thread-quote')?.textContent).toContain(
      'quoted root',
    );
    expect(thread.querySelectorAll('.webclipper-inpage-comments-panel__comment')).toHaveLength(0);
    expect(thread.querySelector('.webclipper-inpage-comments-panel__reply')?.textContent).toContain('comment child');

    mounted.cleanup();
  });

  it('uses the canonical graph for orphan and nested reply placement', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, { surface: 'inpage' });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 10, parentId: 999, createdAt: 1000, authorName: 'You', quoteText: '', commentText: 'orphan-root' },
      { id: 11, parentId: 10, createdAt: 1100, authorName: 'You', quoteText: '', commentText: 'nested-child' },
      { id: 12, parentId: 11, createdAt: 1200, authorName: 'You', quoteText: '', commentText: 'nested-grandchild' },
    ]);

    const shadow = host.querySelector('webclipper-threaded-comments-panel')?.shadowRoot;
    const threads = Array.from(shadow!.querySelectorAll('.webclipper-inpage-comments-panel__thread'));
    expect(threads).toHaveLength(1);
    expect(threads[0].textContent).toContain('orphan-root');
    expect(threads[0].textContent).toContain('nested-child');
    expect(threads[0].textContent).toContain('nested-grandchild');
    mounted.cleanup();
  });
});
