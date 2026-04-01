import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('inpage comments sidebar toggle', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
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
});
