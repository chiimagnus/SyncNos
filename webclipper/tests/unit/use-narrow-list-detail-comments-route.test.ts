import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { useNarrowListDetailCommentsRoute } from '../../src/ui/shared/hooks/useNarrowListDetailCommentsRoute';

type HookSnapshot = ReturnType<typeof useNarrowListDetailCommentsRoute>;

let latestSnapshot: HookSnapshot | null = null;

function RouteHarness({ isNarrow, defaultRoute = 'list' }: { isNarrow: boolean; defaultRoute?: 'list' | 'detail' | 'comments' }) {
  const snapshot = useNarrowListDetailCommentsRoute({ isNarrow, defaultRoute });
  useEffect(() => {
    latestSnapshot = snapshot;
  }, [snapshot]);
  return null;
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event });
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: dom.window.KeyboardEvent });
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
  delete (globalThis as any).Event;
  delete (globalThis as any).KeyboardEvent;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('useNarrowListDetailCommentsRoute', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    latestSnapshot = null;
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('transitions list/detail/comments state and increments listRestoreKey', () => {
    act(() => {
      root!.render(createElement(RouteHarness, { isNarrow: true }));
    });

    expect(latestSnapshot?.route).toBe('list');
    expect(latestSnapshot?.listRestoreKey).toBe(0);

    act(() => {
      latestSnapshot?.openDetail();
    });
    expect(latestSnapshot?.route).toBe('detail');

    act(() => {
      latestSnapshot?.openComments();
    });
    expect(latestSnapshot?.route).toBe('comments');

    act(() => {
      latestSnapshot?.returnToDetail();
    });
    expect(latestSnapshot?.route).toBe('detail');

    act(() => {
      latestSnapshot?.returnToList();
    });
    expect(latestSnapshot?.route).toBe('list');
    expect(latestSnapshot?.listRestoreKey).toBe(1);
  });

  it('handles Escape as comments -> detail -> list', () => {
    act(() => {
      root!.render(createElement(RouteHarness, { isNarrow: true }));
    });

    act(() => {
      latestSnapshot?.openDetail();
      latestSnapshot?.openComments();
    });
    expect(latestSnapshot?.route).toBe('comments');

    const firstEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(firstEscape);
    });
    expect(firstEscape.defaultPrevented).toBe(true);
    expect(latestSnapshot?.route).toBe('detail');

    const secondEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(secondEscape);
    });
    expect(secondEscape.defaultPrevented).toBe(true);
    expect(latestSnapshot?.route).toBe('list');

    const thirdEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(thirdEscape);
    });
    expect(thirdEscape.defaultPrevented).toBe(false);
    expect(latestSnapshot?.route).toBe('list');
  });
});
