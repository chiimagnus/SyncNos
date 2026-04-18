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

describe('Threaded comments panel delete confirmation', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(async () => {
    await flushReactScheduler();
    cleanupDom();
  });

  it('uses inline, two-step confirmation (no alert confirm)', async () => {
    const confirmSpy = vi.fn(() => true);
    Object.defineProperty(globalThis, 'confirm', { configurable: true, value: confirmSpy });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const onDelete = vi.fn().mockResolvedValue(undefined);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    mounted.api.setHandlers({ onDelete });
    mounted.api.setComments([{ id: 1, parentId: null, createdAt: 1000, commentText: 'root' }]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const del = shadow.querySelector('button[data-webclipper-comment-delete-id="1"]') as HTMLButtonElement | null;
    expect(del).toBeTruthy();
    expect(del!.textContent).toBe('×');

    del!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(onDelete).toHaveBeenCalledTimes(0);
    expect(confirmSpy).toHaveBeenCalledTimes(0);
    expect(del!.textContent).toBe('deleteButton');
    expect(del!.getAttribute('data-confirm')).toBe('1');
    expect(del!.classList.contains('webclipper-btn--danger')).toBe(true);
    expect(del!.classList.contains('webclipper-btn--icon')).toBe(false);

    del!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(1);
    expect(confirmSpy).toHaveBeenCalledTimes(0);
    expect(del!.textContent).toBe('×');

    mounted.cleanup();
  });

  it('cancels pending confirmation on outside click and Escape', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onDelete = vi.fn().mockResolvedValue(undefined);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    mounted.api.setHandlers({ onDelete });
    mounted.api.setComments([{ id: 1, parentId: null, createdAt: 1000, commentText: 'root' }]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const del = shadow.querySelector('button[data-webclipper-comment-delete-id="1"]') as HTMLButtonElement | null;
    expect(del).toBeTruthy();

    del!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(del!.textContent).toBe('deleteButton');

    const commentBody = shadow.querySelector(
      '.webclipper-inpage-comments-panel__comment > .webclipper-inpage-comments-panel__text',
    ) as HTMLElement | null;
    expect(commentBody).toBeTruthy();
    commentBody!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(del!.textContent).toBe('×');

    del!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(del!.textContent).toBe('deleteButton');

    shadow.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flushPromises();
    expect(del!.textContent).toBe('×');

    expect(onDelete).toHaveBeenCalledTimes(0);

    mounted.cleanup();
  });

  it('keeps armed state on delete-button pointerdown so second click really deletes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onDelete = vi.fn().mockResolvedValue(undefined);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    mounted.api.setHandlers({ onDelete });
    mounted.api.setComments([{ id: 1, parentId: null, createdAt: 1000, commentText: 'root' }]);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const del = shadow.querySelector('button[data-webclipper-comment-delete-id="1"]') as HTMLButtonElement | null;
    expect(del).toBeTruthy();

    del!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(del!.textContent).toBe('deleteButton');
    expect(onDelete).toHaveBeenCalledTimes(0);

    const PointerCtor = (window as any).PointerEvent || window.MouseEvent;
    const pointer = new PointerCtor('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    del!.dispatchEvent(pointer as Event);

    del!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(1);

    mounted.cleanup();
  });
});
