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
  Object.defineProperty(globalThis, 'getSelection', {
    configurable: true,
    value: dom.window.getSelection.bind(dom.window),
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
  delete (globalThis as any).getSelection;
}

function installMutableSelectionMock(initialText: string) {
  const state = { text: String(initialText || '') };
  const selectionMock = {
    rangeCount: 1,
    anchorNode: document.body,
    focusNode: document.body,
    anchorOffset: 0,
    get focusOffset() {
      return String(state.text || '').length;
    },
    toString: () => String(state.text || ''),
    getRangeAt: () => {
      const range = document.createRange();
      range.selectNodeContents(document.body);
      return range;
    },
    removeAllRanges: () => {},
    addRange: () => {},
  } as any;
  Object.defineProperty(globalThis, 'getSelection', {
    configurable: true,
    value: () => selectionMock as Selection,
  });
  return state;
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

describe('Threaded comments panel auto-attach selection trigger', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(async () => {
    await flushReactScheduler();
    cleanupDom();
  });

  it('requests selection on document selectionchange and dedupes identical signatures', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onComposerSelectionRequest = vi.fn();
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    mounted.api.setHandlers({ onComposerSelectionRequest } as any);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const selectionState = installMutableSelectionMock('Quoted text');
    expect(selectionState.text).toBe('Quoted text');

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('selectionchange'));

    await Promise.resolve();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);
    expect(onComposerSelectionRequest).toHaveBeenCalledWith({ trigger: 'auto' });

    mounted.cleanup();
  });

  it('does not clear quote when composer/reply interactions cause empty selectionchange', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onComposerSelectionRequest = vi.fn();
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    mounted.api.setHandlers({ onComposerSelectionRequest } as any);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;
    const selectionState = installMutableSelectionMock('Quoted text');

    mounted.api.setComments([{ id: 1, parentId: null, createdAt: Date.now(), commentText: 'root' }]);

    document.dispatchEvent(new window.Event('selectionchange'));
    await Promise.resolve();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);
    expect(onComposerSelectionRequest).toHaveBeenLastCalledWith({ trigger: 'auto' });

    selectionState.text = '';

    const composer = shadow.querySelector(
      '.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement | null;
    expect(composer).toBeTruthy();

    composer!.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    composer!.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    document.dispatchEvent(new window.Event('selectionchange'));
    await Promise.resolve();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    const reply = shadow.querySelector(
      '.webclipper-inpage-comments-panel__reply-textarea',
    ) as HTMLTextAreaElement | null;
    expect(reply).toBeTruthy();

    reply!.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    reply!.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    document.dispatchEvent(new window.Event('selectionchange'));
    await Promise.resolve();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    mounted.cleanup();
  });

  it('renders comments header title and no manual attach-selection button', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const headerTitle = shadow.querySelector(
      '.webclipper-inpage-comments-panel__header-title',
    ) as HTMLElement | null;
    expect(headerTitle).toBeTruthy();
    expect(headerTitle?.textContent).toBe('articleCommentsHeading');

    const attachSelectionBtn = shadow.querySelector(
      '.webclipper-inpage-comments-panel__attach-selection',
    ) as HTMLButtonElement | null;
    expect(attachSelectionBtn).toBeFalsy();

    mounted.cleanup();
  });
});
