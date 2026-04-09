import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

import { getInpageCommentsPanelApi } from '../../src/ui/inpage/inpage-comments-panel-shadow';

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
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
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
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
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

describe('inpage comments sidebar toggle', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(async () => {
    await flushReactScheduler();
    cleanupDom();
  });

  it('renders as a docked sidebar with a collapse button; repeat open keeps it open', () => {
    const api = getInpageCommentsPanelApi();

    api.open({ focusComposer: true });

    expect(api.isOpen()).toBe(true);

    const host = document.getElementById('webclipper-inpage-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();

    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();
    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__header-title')).toBeTruthy();
    const collapse = shadow?.querySelector('.webclipper-inpage-comments-panel__collapse') as HTMLButtonElement | null;
    expect(collapse).toBeTruthy();

    api.setComments([{ id: 1, parentId: null, createdAt: Date.now(), commentText: 'Root comment' }]);
    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__comment-chatwith-trigger')).toBeTruthy();

    api.open({ focusComposer: true });

    expect(api.isOpen()).toBe(true);

    collapse?.click();
    expect(api.isOpen()).toBe(false);
  });

  it('triggers composer selection request only from root composer interactions', async () => {
    const api = getInpageCommentsPanelApi();
    const onComposerSelectionRequest = vi.fn();

    api.setHandlers({ onComposerSelectionRequest } as any);
    api.setComments([{ id: 1, parentId: null, createdAt: Date.now(), commentText: 'Root comment' }]);
    api.open({ focusComposer: false });

    const host = document.getElementById('webclipper-inpage-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();

    const composer = shadow?.querySelector(
      '.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement | null;
    expect(composer).toBeTruthy();
    composer?.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);
    expect(onComposerSelectionRequest).toHaveBeenLastCalledWith({ trigger: 'pointerdown' });

    const reply = shadow?.querySelector(
      '.webclipper-inpage-comments-panel__reply-textarea',
    ) as HTMLTextAreaElement | null;
    expect(reply).toBeTruthy();
    reply?.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    reply?.dispatchEvent(new window.FocusEvent('focus', { bubbles: true }));

    await Promise.resolve();
    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);
  });
});
