import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({ t: (key: string) => key }));

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
  delete (globalThis as any).confirm;
}

async function flushReactScheduler() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise<void>((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
  await Promise.resolve();
}

function panelShadow(host: HTMLElement): ShadowRoot {
  return (host.querySelector('webclipper-threaded-comments-panel') as HTMLElement).shadowRoot!;
}

async function openRootMenu(shadow: ShadowRoot) {
  const trigger = shadow.querySelector(
    '.webclipper-inpage-comments-panel__comment .webclipper-inpage-comments-panel__overflow-trigger',
  ) as HTMLButtonElement;
  expect(trigger).toBeTruthy();
  trigger.click();
  await flushReactScheduler();
}

function deleteButton(shadow: ShadowRoot): HTMLButtonElement {
  const button = shadow.querySelector(
    'button.webclipper-inpage-comments-panel__overflow-menu-item[data-destructive="1"]',
  ) as HTMLButtonElement | null;
  expect(button).toBeTruthy();
  return button!;
}

describe('Threaded comments panel delete confirmation', () => {
  beforeEach(setupDom);
  afterEach(async () => {
    await flushReactScheduler();
    cleanupDom();
  });

  it('uses an inline two-step menu confirmation without window.confirm', async () => {
    const confirmSpy = vi.fn(() => true);
    Object.defineProperty(globalThis, 'confirm', { configurable: true, value: confirmSpy });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const mounted = mountThreadedCommentsPanel(host, { surface: 'inpage' });
    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({ onDelete });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'root' },
    ]);
    const shadow = panelShadow(host);
    await openRootMenu(shadow);

    let del = deleteButton(shadow);
    expect(del.textContent).toBe('Delete');
    del.click();
    await flushReactScheduler();
    del = deleteButton(shadow);
    expect(onDelete).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(del.textContent).toBe('deleteButton');
    expect(del.getAttribute('data-confirm')).toBe('1');
    expect(del.classList.contains('webclipper-btn--danger')).toBe(true);

    del.click();
    await flushReactScheduler();
    expect(onDelete).toHaveBeenCalledWith(1);
    expect(confirmSpy).not.toHaveBeenCalled();

    mounted.cleanup();
  });

  it('shows a notice and keeps the comment when deletion fails', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onDelete = vi.fn().mockRejectedValue(new Error('Delete failed.'));
    const mounted = mountThreadedCommentsPanel(host, { surface: 'inpage' });
    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({ onDelete });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'root' },
    ]);
    const shadow = panelShadow(host);
    await openRootMenu(shadow);

    deleteButton(shadow).click();
    await flushReactScheduler();
    deleteButton(shadow).click();
    await flushReactScheduler();

    expect(onDelete).toHaveBeenCalledWith(1);
    expect(shadow.querySelector('[data-thread-root-id="1"]')).toBeTruthy();
    expect((shadow.querySelector('.webclipper-inpage-comments-panel__notice') as HTMLElement).textContent).toContain(
      'Delete failed.',
    );

    mounted.cleanup();
  });

  it('cancels pending confirmation on outside click and ignores Escape', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const mounted = mountThreadedCommentsPanel(host, { surface: 'inpage' });
    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({ onDelete });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'root' },
    ]);
    const shadow = panelShadow(host);
    await openRootMenu(shadow);

    deleteButton(shadow).click();
    await flushReactScheduler();
    expect(deleteButton(shadow).textContent).toBe('deleteButton');

    const commentBody = shadow.querySelector(
      '.webclipper-inpage-comments-panel__comment-main > .webclipper-inpage-comments-panel__text',
    ) as HTMLElement;
    commentBody.click();
    await flushReactScheduler();
    expect(deleteButton(shadow).textContent).toBe('Delete');

    await openRootMenu(shadow);
    deleteButton(shadow).click();
    await flushReactScheduler();
    expect(deleteButton(shadow).textContent).toBe('deleteButton');
    const surface = shadow.querySelector('.webclipper-inpage-comments-panel__surface') as HTMLElement;
    const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    surface.dispatchEvent(escape);
    await flushReactScheduler();
    expect(escape.defaultPrevented).toBe(false);
    expect(deleteButton(shadow).textContent).toBe('deleteButton');
    expect(onDelete).not.toHaveBeenCalled();

    mounted.cleanup();
  });

  it('keeps armed state on delete-button pointerdown so the second click deletes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const mounted = mountThreadedCommentsPanel(host, { surface: 'inpage' });
    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({ onDelete });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'root' },
    ]);
    const shadow = panelShadow(host);
    await openRootMenu(shadow);

    deleteButton(shadow).click();
    await flushReactScheduler();
    let del = deleteButton(shadow);
    expect(del.textContent).toBe('deleteButton');

    const PointerCtor = (window as any).PointerEvent || window.MouseEvent;
    del.dispatchEvent(new PointerCtor('pointerdown', { bubbles: true, cancelable: true, composed: true }));
    del = deleteButton(shadow);
    del.click();
    await flushReactScheduler();
    expect(onDelete).toHaveBeenCalledWith(1);

    mounted.cleanup();
  });
});
