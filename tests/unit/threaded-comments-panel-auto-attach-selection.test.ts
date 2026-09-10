import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
}));

import { mountThreadedCommentsPanel } from '@ui/comments';
import { getCommentSidebarPanelTestDriver } from '../helpers/comment-sidebar-panel-driver';
import { flushCommentsReactWork } from '../helpers/comments-test-harness';

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
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
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
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
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
    await flushCommentsReactWork();
    cleanupDom();
  });

  it('requests selection on pointerup commit and dedupes identical signatures', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onComposerSelectionRequest = vi.fn();
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({ onComposerSelectionRequest } as any);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const selectionState = installMutableSelectionMock('Quoted text');
    expect(selectionState.text).toBe('Quoted text');

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushCommentsReactWork();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);
    expect(onComposerSelectionRequest).toHaveBeenCalledWith({ trigger: 'auto' });

    mounted.cleanup();
  });

  it('submits an empty root when a valid quote locator is attached', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    const driver = getCommentSidebarPanelTestDriver(mounted.api);
    const onSave = vi.fn(async () => ({ ok: true, createdRootId: 7 }));
    driver.replaceActionCallbacks({ onSave } as any);
    driver.session.setComposerAttachment({
      displayQuote: 'Quoted text',
      locator: {
        v: 1,
        env: 'app',
        quote: { type: 'TextQuoteSelector', exact: 'Quoted text' },
        position: { type: 'TextPositionSelector', start: 0, end: 11 },
      },
    });
    await flushCommentsReactWork();

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement;
    const send = panel.shadowRoot!.querySelector('.webclipper-inpage-comments-panel__send') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    send.click();
    await flushCommentsReactWork();

    expect(onSave).toHaveBeenCalledWith('');
    mounted.cleanup();
  });

  it('keeps highlight-only submit disabled when the attached locator points at different text', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    const driver = getCommentSidebarPanelTestDriver(mounted.api);
    const onSave = vi.fn(async () => ({ ok: true, createdRootId: 8 }));
    driver.replaceActionCallbacks({ onSave } as any);
    driver.session.setComposerAttachment({
      displayQuote: 'Quoted text',
      locator: {
        v: 1,
        env: 'app',
        quote: { type: 'TextQuoteSelector', exact: 'Different text' },
        position: { type: 'TextPositionSelector', start: 0, end: 14 },
      },
    });
    await flushCommentsReactWork();

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement;
    const send = panel.shadowRoot!.querySelector('.webclipper-inpage-comments-panel__send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    send.click();
    await flushCommentsReactWork();

    expect(onSave).not.toHaveBeenCalled();
    mounted.cleanup();
  });

  it('requests selection when Selection.toString() is empty but Range contains text (Firefox quirk)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const textNode = document.createElement('p');
    textNode.textContent = 'Quote from range';
    document.body.appendChild(textNode);

    const onComposerSelectionRequest = vi.fn();
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({ onComposerSelectionRequest } as any);

    const selectionMock = {
      rangeCount: 1,
      anchorNode: textNode.firstChild,
      focusNode: textNode.firstChild,
      anchorOffset: 0,
      focusOffset: 5,
      toString: () => '',
      getRangeAt: () => {
        const range = document.createRange();
        range.selectNodeContents(textNode);
        return range;
      },
      removeAllRanges: () => {},
      addRange: () => {},
    } as any;
    Object.defineProperty(globalThis, 'getSelection', { configurable: true, value: () => selectionMock as Selection });

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushCommentsReactWork();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    mounted.cleanup();
  });

  it('commits keyboard selection only after modifier is released (shift + arrow)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onComposerSelectionRequest = vi.fn();
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({ onComposerSelectionRequest } as any);

    const selectionState = installMutableSelectionMock('Quoted text');

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true }));
    await flushCommentsReactWork();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(0);

    document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));
    await flushCommentsReactWork();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    selectionState.text = '';
    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));
    await flushCommentsReactWork();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    mounted.cleanup();
  });

  it('does not clear quote when composer/reply interactions cause empty selectionchange', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onComposerSelectionRequest = vi.fn();
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });
    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({ onComposerSelectionRequest } as any);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;
    const selectionState = installMutableSelectionMock('Quoted text');

    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: Date.now(), commentText: 'root' },
    ]);

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushCommentsReactWork();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);
    expect(onComposerSelectionRequest).toHaveBeenLastCalledWith({ trigger: 'auto' });

    selectionState.text = '';

    const composer = shadow.querySelector(
      '.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement | null;
    expect(composer).toBeTruthy();

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushCommentsReactWork();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    (shadow.querySelector('.webclipper-inpage-comments-panel__comment') as HTMLElement).click();
    await flushCommentsReactWork();
    const reply = shadow.querySelector(
      '.webclipper-inpage-comments-panel__reply-textarea',
    ) as HTMLTextAreaElement | null;
    expect(reply).toBeTruthy();

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushCommentsReactWork();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    mounted.cleanup();
  });

  it('clears quote only via explicit ❌ and allows reattaching the same selection', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const onComposerSelectionRequest = vi.fn();
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: true });

    getCommentSidebarPanelTestDriver(mounted.api).replaceActionCallbacks({
      onComposerSelectionRequest,
      onComposerQuoteClearRequest: () => {
        getCommentSidebarPanelTestDriver(mounted.api).updateComposerQuote('');
      },
    } as any);

    const panel = host.querySelector('webclipper-threaded-comments-panel') as HTMLElement | null;
    expect(panel).toBeTruthy();
    const shadow = panel!.shadowRoot!;

    const selectionState = installMutableSelectionMock('Same quote');

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushCommentsReactWork();

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    getCommentSidebarPanelTestDriver(mounted.api).updateComposerQuote(selectionState.text);
    await flushCommentsReactWork();

    const clearBtn = shadow.querySelector('.webclipper-inpage-comments-panel__quote-clear') as HTMLButtonElement | null;
    expect(clearBtn).toBeTruthy();
    clearBtn!.click();
    await flushCommentsReactWork();

    const quoteEl = shadow.querySelector('.webclipper-inpage-comments-panel__quote') as HTMLElement | null;
    expect(quoteEl).toBeFalsy();

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.Event('pointerup'));
    await flushCommentsReactWork();

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
