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

  (dom.window.HTMLElement.prototype as any).attachEvent ||= () => {};
  (dom.window.HTMLElement.prototype as any).detachEvent ||= () => {};
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

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
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

describe('Threaded comments panel shortcuts', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(async () => {
    await flushReactScheduler();
    cleanupDom();
  });

  it('sends composer comment on Cmd+Enter', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onSave = vi.fn().mockResolvedValue(undefined);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({ onSave });

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const textarea = shadow.querySelector(
      '.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    textarea!.focus();
    textarea!.value = 'hello';
    textarea!.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }));
    await flushReactScheduler();

    textarea!.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushPromises();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('hello');

    mounted.cleanup();
  });

  it('sends a highlight-only root on Cmd+Enter when quote and locator match', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onSave = vi.fn().mockResolvedValue({ ok: true, createdRootId: 2 });
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    const driver = getCommentSidebarPanelTestDriver(mounted.api);
    driver.replaceActionCallbacks({ onSave });
    driver.session.setComposerAttachment({
      displayQuote: 'highlight',
      locator: {
        v: 1,
        env: 'app',
        quote: { type: 'TextQuoteSelector', exact: 'highlight' },
        position: { type: 'TextPositionSelector', start: 0, end: 9 },
      },
    });
    await flushReactScheduler();

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement;
    const textarea = panel.shadowRoot!.querySelector(
      '.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement;
    textarea.focus();
    textarea.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushPromises();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('');
    mounted.cleanup();
  });

  it('sends reply on Cmd+Enter', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onReply = vi.fn().mockResolvedValue(undefined);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({ onReply });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'root' },
    ]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const textarea = shadow.querySelector(
      '.webclipper-inpage-comments-panel__reply-textarea',
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    textarea!.focus();
    textarea!.value = 'reply';
    textarea!.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }));
    await flushReactScheduler();

    textarea!.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushPromises();

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith(1, 'reply');

    mounted.cleanup();
  });

  it('preserves the root draft when the host reports a no-op save', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onSave = vi.fn().mockResolvedValue(false);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({ onSave });
    const shadow = (host.querySelector('webclipper-threaded-comments-panel') as HTMLElement).shadowRoot!;
    const textarea = shadow.querySelector(
      '.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement;
    textarea.value = 'keep root draft';
    textarea.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }));
    await flushReactScheduler();

    (
      shadow.querySelector(
        '[data-webclipper-root-composer="1"] .webclipper-inpage-comments-panel__send',
      ) as HTMLButtonElement
    ).click();
    await flushReactScheduler();

    expect(onSave).toHaveBeenCalledWith('keep root draft');
    expect(textarea.value).toBe('keep root draft');
    expect((shadow.querySelector('.webclipper-inpage-comments-panel__notice') as HTMLElement).textContent).toContain(
      'Comment was not saved.',
    );
    expect(
      errorSpy.mock.calls.some((args) =>
        args.some((value) => String(value).includes('flushSync was called from inside a lifecycle method')),
      ),
    ).toBe(false);
    errorSpy.mockRestore();
    mounted.cleanup();
  });

  it('preserves the reply draft when the host reports a no-op reply', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onReply = vi.fn().mockResolvedValue(false);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    const driver = getCommentSidebarPanelTestDriver(mounted.api);
    driver.replaceActionCallbacks({ onReply });
    driver.replaceComments([{ id: 1, parentId: null, createdAt: 1000, commentText: 'root' }]);
    const shadow = (host.querySelector('webclipper-threaded-comments-panel') as HTMLElement).shadowRoot!;
    const textarea = shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea') as HTMLTextAreaElement;
    textarea.value = 'keep reply draft';
    textarea.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }));
    await flushReactScheduler();

    (
      shadow.querySelector(
        '[data-reply-composer-root-id="1"] .webclipper-inpage-comments-panel__send',
      ) as HTMLButtonElement
    ).click();
    await flushReactScheduler();

    expect(onReply).toHaveBeenCalledWith(1, 'keep reply draft');
    expect(textarea.value).toBe('keep reply draft');
    expect((shadow.querySelector('.webclipper-inpage-comments-panel__notice') as HTMLElement).textContent).toContain(
      'Reply was not saved.',
    );
    mounted.cleanup();
  });
});
