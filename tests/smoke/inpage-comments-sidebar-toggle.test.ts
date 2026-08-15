import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { JSDOM } from 'jsdom';

import {
  createInpageCommentsDomSource,
  getInpageCommentsPanelApi,
} from '../../src/ui/inpage/inpage-comments-panel-shadow';
import { ARTICLE_MESSAGE_TYPES, CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { createCommentSidebarPanelTestDriver } from '../helpers/comment-sidebar-panel-driver';

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
  Object.defineProperty(globalThis, 'getSelection', {
    configurable: true,
    value: dom.window.getSelection.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(globalThis, 'innerWidth', { configurable: true, writable: true, value: 1280 });
  Object.defineProperty(globalThis, 'addEventListener', {
    configurable: true,
    value: dom.window.addEventListener.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'removeEventListener', {
    configurable: true,
    value: dom.window.removeEventListener.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: dom.window.requestAnimationFrame.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: dom.window.cancelAnimationFrame.bind(dom.window),
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
  delete (globalThis as any).getSelection;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  delete (globalThis as any).innerWidth;
  delete (globalThis as any).addEventListener;
  delete (globalThis as any).removeEventListener;
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
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

describe('inpage comments sidebar toggle', () => {
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

  it('renders as a docked sidebar with a collapse button; repeat open keeps it open', async () => {
    const api = createCommentSidebarPanelTestDriver(getInpageCommentsPanelApi());

    await act(async () => {
      api.open({ focusComposer: true });
      await flushReactScheduler();
    });

    expect(api.isOpen()).toBe(true);

    const host = document.getElementById('webclipper-inpage-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();

    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();
    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__header-title')).toBeTruthy();
    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__attach-selection')).toBeFalsy();
    const collapse = shadow?.querySelector('.webclipper-inpage-comments-panel__collapse') as HTMLButtonElement | null;
    expect(collapse).toBeTruthy();

    act(() => {
      api.replaceComments([{ id: 1, parentId: null, createdAt: Date.now(), commentText: 'Root comment' }]);
    });
    expect(
      shadow?.querySelector('[data-thread-root-id="1"] .webclipper-inpage-comments-panel__overflow-trigger'),
    ).toBeTruthy();

    await act(async () => {
      api.open({ focusComposer: true });
      await flushReactScheduler();
    });

    expect(api.isOpen()).toBe(true);

    act(() => {
      collapse?.click();
    });
    expect(api.isOpen()).toBe(false);
    api.dispose();
  });

  it('resolves inpage ChatWith detail through a fresh stable reference and epoch', async () => {
    const runtime = {
      send: vi.fn(async (type: string, payload?: Record<string, unknown>) => {
        if (type === ARTICLE_MESSAGE_TYPES.RESOLVE_OR_CAPTURE_ACTIVE_TAB) {
          return {
            ok: true,
            data: {
              conversationId: 8,
              url: 'https://example.com/article',
              title: 'Example article',
              author: 'Author',
              publishedAt: '2026-08-15',
            },
          };
        }
        if (type === CORE_MESSAGE_TYPES.FIND_CONVERSATION_BY_SOURCE_AND_KEY) {
          expect(payload).toEqual({ source: 'web', conversationKey: 'article:https://example.com/article' });
          return {
            ok: true,
            data: {
              id: 8,
              source: 'web',
              conversationKey: 'article:https://example.com/article',
              factsEpoch: 'idb-v1',
              lastCapturedAt: 1,
            },
          };
        }
        if (type === CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL) {
          expect(payload).toEqual({
            source: 'web',
            conversationKey: 'article:https://example.com/article',
            factsEpoch: 'idb-v1',
          });
          return {
            ok: true,
            data: {
              conversationId: 8,
              source: 'web',
              conversationKey: 'article:https://example.com/article',
              factsEpoch: 'idb-v1',
              messages: [{ id: 1, conversationId: 8, messageKey: 'm1', role: 'assistant', contentText: 'Body' }],
            },
          };
        }
        return { ok: false, error: { message: `unexpected ${type}` } };
      }),
    };
    const api = createCommentSidebarPanelTestDriver(getInpageCommentsPanelApi(runtime));

    await act(async () => {
      api.open({ focusComposer: false });
      await flushReactScheduler();
    });

    const trigger = document
      .getElementById('webclipper-inpage-comments-panel')
      ?.shadowRoot?.querySelector(
        '.webclipper-inpage-comments-panel__header .webclipper-inpage-comments-panel__overflow-trigger',
      ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.click();
      await vi.waitFor(() => {
        expect(runtime.send).toHaveBeenCalledWith(CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL, expect.any(Object));
      });
    });

    expect(runtime.send).not.toHaveBeenCalledWith(
      CORE_MESSAGE_TYPES.GET_CONVERSATION_DETAIL,
      expect.objectContaining({ conversationId: expect.anything() }),
    );
    api.dispose();
  });

  it('triggers composer selection request on pointerup commit (not selectionchange only)', async () => {
    const api = createCommentSidebarPanelTestDriver(getInpageCommentsPanelApi());
    const onComposerSelectionRequest = vi.fn();

    act(() => {
      api.replaceActionCallbacks({ onComposerSelectionRequest } as any);
      api.replaceComments([{ id: 1, parentId: null, createdAt: Date.now(), commentText: 'Root comment' }]);
      api.open({ focusComposer: false });
    });

    const host = document.getElementById('webclipper-inpage-comments-panel') as HTMLElement | null;
    expect(host).toBeTruthy();
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();

    const selectionMock = {
      rangeCount: 1,
      anchorNode: document.body,
      focusNode: document.body,
      anchorOffset: 0,
      focusOffset: 4,
      toString: () => 'Quote',
      getRangeAt: () => {
        const range = document.createRange();
        range.selectNodeContents(document.body);
        return range;
      },
      removeAllRanges: () => {},
      addRange: () => {},
    } as any;
    const selectionSpy = vi.spyOn(globalThis, 'getSelection').mockImplementation(() => selectionMock as Selection);

    await act(async () => {
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.Event('pointerup'));
      await flushReactScheduler();
    });

    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);
    expect(onComposerSelectionRequest).toHaveBeenLastCalledWith({ trigger: 'auto' });

    const composer = shadow?.querySelector(
      '.webclipper-inpage-comments-panel__composer-textarea',
    ) as HTMLTextAreaElement | null;
    expect(composer).toBeTruthy();
    selectionSpy.mockImplementation(() => ({ ...selectionMock, toString: () => '' }) as Selection);
    await act(async () => {
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.Event('pointerup'));
      await flushReactScheduler();
    });
    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));
      await flushReactScheduler();
    });
    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    expect(shadow?.querySelector('.webclipper-inpage-comments-panel__attach-selection')).toBeFalsy();

    const reply = shadow?.querySelector(
      '.webclipper-inpage-comments-panel__reply-textarea',
    ) as HTMLTextAreaElement | null;
    expect(reply).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new window.Event('selectionchange'));
      document.dispatchEvent(new window.Event('pointerup'));
      await flushReactScheduler();
    });
    expect(onComposerSelectionRequest).toHaveBeenCalledTimes(1);

    selectionSpy.mockRestore();
    api.dispose();
  });

  it('reuses one panel across SPA routes and keeps dock cleanup responsive to viewport changes', async () => {
    const api = createCommentSidebarPanelTestDriver(getInpageCommentsPanelApi());
    const domSource = createInpageCommentsDomSource({ window, document });

    await act(async () => {
      api.open({ focusComposer: false });
      await flushReactScheduler();
    });

    const firstHost = document.getElementById('webclipper-inpage-comments-panel') as HTMLElement | null;
    expect(firstHost).toBeTruthy();
    expect(document.documentElement.getAttribute('data-webclipper-comments-dock')).toBe('1');
    expect(domSource.readPageUrl()).toBe('https://example.com/');

    window.history.pushState({}, '', '/article/next?view=discussion');
    await act(async () => {
      api.open({ focusComposer: false });
      await flushReactScheduler();
    });

    expect(domSource.readPageUrl()).toBe('https://example.com/article/next?view=discussion');
    expect(document.getElementById('webclipper-inpage-comments-panel')).toBe(firstHost);
    expect(document.querySelectorAll('#webclipper-inpage-comments-panel')).toHaveLength(1);

    (globalThis as any).innerWidth = 640;
    await act(async () => {
      window.dispatchEvent(new window.Event('resize'));
      await flushReactScheduler();
    });
    expect(document.documentElement.hasAttribute('data-webclipper-comments-dock')).toBe(false);

    (globalThis as any).innerWidth = 1280;
    await act(async () => {
      window.dispatchEvent(new window.Event('resize'));
      await flushReactScheduler();
    });
    expect(document.documentElement.getAttribute('data-webclipper-comments-dock')).toBe('1');

    const collapse = firstHost?.shadowRoot?.querySelector(
      '.webclipper-inpage-comments-panel__collapse',
    ) as HTMLButtonElement | null;
    act(() => collapse?.click());
    expect(document.documentElement.hasAttribute('data-webclipper-comments-dock')).toBe(false);

    await act(async () => {
      api.open({ focusComposer: false });
      await flushReactScheduler();
    });
    expect(document.documentElement.getAttribute('data-webclipper-comments-dock')).toBe('1');

    api.dispose();
  });

  it('captures a multi-line page range with a V2 locator and rejects iframe execution', () => {
    document.body.innerHTML = '<main><article id="story">Line one\nLine two</article></main>';
    const story = document.getElementById('story')!;
    const text = story.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.textContent?.length || 0);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const topFrameSource = createInpageCommentsDomSource({ window, document });
    const captured = topFrameSource.resolveComposerSelection();
    expect(topFrameSource.isTopFrame()).toBe(true);
    expect(captured.selectionText).toBe('Line one\nLine two');
    expect(captured.locator).toMatchObject({
      v: 2,
      textModelVersion: 'dom-text-v2',
      surfaceHint: 'inpage',
      quote: { exact: 'Line one\nLine two' },
    });

    const frameWindow = {
      self: {},
      top: {},
      location: { href: 'https://example.com/frame' },
    } as unknown as Window;
    const frameSource = createInpageCommentsDomSource({ window: frameWindow, document });
    expect(frameSource.isTopFrame()).toBe(false);
    expect(frameSource.readPageUrl()).toBe('https://example.com/frame');
  });
});
