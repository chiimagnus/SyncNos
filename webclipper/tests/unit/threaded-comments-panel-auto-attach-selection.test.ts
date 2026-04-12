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
  if (vi.isFakeTimers()) {
    vi.runOnlyPendingTimers();
    await Promise.resolve();
    return;
  }
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
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(async () => {
    if (vi.isFakeTimers()) {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
    await flushReactScheduler();
    cleanupDom();
  });

  it('requests selection on pointerup commit and dedupes identical signatures', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onComposerSelectionRequest = vi.fn();
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    mounted.api.setHandlers({ onComposerSelectionRequest } as any);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const selectionState = installMutableSelectionMock('Quoted text');
    expect(selectionState.text).toBe('Quoted text');

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushReactScheduler();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);
    expect(onComposerSelectionRequest).toHaveBeenCalledWith({ trigger: 'auto' });

    mounted.cleanup();
  });

  it('commits keyboard selection only after modifier is released (shift + arrow)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onComposerSelectionRequest = vi.fn();
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    mounted.api.setHandlers({ onComposerSelectionRequest } as any);

    const selectionState = installMutableSelectionMock('Quoted text');

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true }));
    await flushReactScheduler();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(0);

    document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));
    await flushReactScheduler();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    selectionState.text = '';
    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));
    await flushReactScheduler();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

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
    document.dispatchEvent(new window.Event('pointerup'));
    await flushReactScheduler();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);
    expect(onComposerSelectionRequest).toHaveBeenLastCalledWith({ trigger: 'auto' });

    selectionState.text = '';

    const composer = shadow.querySelector(
      '.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement | null;
    expect(composer).toBeTruthy();

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushReactScheduler();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    const reply = shadow.querySelector(
      '.webclipper-inpage-comments-panel__reply-textarea',
    ) as HTMLTextAreaElement | null;
    expect(reply).toBeTruthy();

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushReactScheduler();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    mounted.cleanup();
  });

  it('clears quote only via explicit ❌ and allows reattaching the same selection', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onComposerSelectionRequest = vi.fn();
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });

    mounted.api.setHandlers({
      onComposerSelectionRequest,
      onComposerQuoteClearRequest: () => {
        mounted.api.setQuoteText('');
      },
    } as any);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const selectionState = installMutableSelectionMock('Same quote');

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushReactScheduler();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    mounted.api.setQuoteText(selectionState.text);
    await flushReactScheduler();

    const clearBtn = shadow.querySelector('.webclipper-inpage-comments-panel__quote-clear') as HTMLButtonElement | null;
    expect(clearBtn).toBeTruthy();
    clearBtn!.click();
    await flushReactScheduler();

    const quoteEl = shadow.querySelector('.webclipper-inpage-comments-panel__quote') as HTMLElement | null;
    expect(quoteEl).toBeFalsy();

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushReactScheduler();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(2);

    mounted.cleanup();
  });

  it('renders comments header title and no manual attach-selection button', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const headerTitle = shadow.querySelector('.webclipper-inpage-comments-panel__header-title') as HTMLElement | null;
    expect(headerTitle).toBeTruthy();
    expect(headerTitle?.textContent).toBe('articleCommentsHeading');

    const attachSelectionBtn = shadow.querySelector(
      '.webclipper-inpage-comments-panel__attach-selection',
    ) as HTMLButtonElement | null;
    expect(attachSelectionBtn).toBeFalsy();

    mounted.cleanup();
  });
});
