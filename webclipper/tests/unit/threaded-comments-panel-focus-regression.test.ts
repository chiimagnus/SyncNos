import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
}));

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

describe('Threaded comments panel focus regression', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(async () => {
    await flushReactScheduler();
    cleanupDom();
  });

  it('focuses reply textarea after comment save even if focus briefly moves outside', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    mounted.api.setComments([]);

    let nextId = 1;
    mounted.api.setHandlers({
      onSave: async (text) => {
        const id = nextId++;
        mounted.api.setComments([
          {
            id,
            parentId: null,
            createdAt: Date.now(),
            commentText: String(text),
          },
        ]);
        return { ok: true, createdRootId: id };
      },
    });

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const composer = shadow.querySelector(
      '.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement | null;
    expect(composer).toBeTruthy();

    composer!.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    composer!.value = 'hello comment';
    composer!.dispatchEvent(new window.Event('input', { bubbles: true }));

    const send = shadow.querySelector(
      '.webclipper-inpage-comments-panel__composer-actions .webclipper-inpage-comments-panel__send',
    ) as HTMLButtonElement | null;
    expect(send).toBeTruthy();
    send!.click();

    composer!.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
    await flushPromises();

    const replyTextarea = shadow.querySelector(
      '.webclipper-inpage-comments-panel__reply-textarea',
    ) as HTMLTextAreaElement | null;
    expect(replyTextarea).toBeTruthy();
    expect(shadow.activeElement).toBe(replyTextarea);

    mounted.cleanup();
  });
});

