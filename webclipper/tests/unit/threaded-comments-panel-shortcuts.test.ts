import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
}));

import { mountThreadedCommentsPanel } from '@services/comments/threaded-comments-panel';

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

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Threaded comments panel shortcuts', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    cleanupDom();
  });

  it('sends composer comment on Cmd+Enter', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onSave = vi.fn().mockResolvedValue(undefined);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    mounted.api.setHandlers({ onSave });

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const textarea = shadow.querySelector(
      '.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    textarea!.value = 'hello';

    textarea!.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }),
    );
    await flushPromises();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('hello');

    mounted.cleanup();
  });

  it('sends reply on Cmd+Enter', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onReply = vi.fn().mockResolvedValue(undefined);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    mounted.api.setHandlers({ onReply });
    mounted.api.setComments([{ id: 1, parentId: null, createdAt: 1000, commentText: 'root' }]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const textarea = shadow.querySelector(
      '.webclipper-inpage-comments-panel__reply-textarea',
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    textarea!.value = 'reply';

    textarea!.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }),
    );
    await flushPromises();

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith(1, 'reply');

    mounted.cleanup();
  });
});

