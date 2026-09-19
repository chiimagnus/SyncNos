import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const state = vi.hoisted(() => ({
  loadingInitialList: true,
  replaceSelectedIds: vi.fn(),
  read: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as null | ((conversationIds: number[]) => void),
}));

vi.mock('@viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => ({
    loadingInitialList: state.loadingInitialList,
    replaceSelectedIds: state.replaceSelectedIds,
  }),
}));

vi.mock('@services/conversations/popup-sync-selection-handoff', () => ({
  readPopupSyncSelectionHandoff: (...args: unknown[]) => state.read(...args),
  subscribePopupSyncSelectionHandoff: (...args: unknown[]) => state.subscribe(...args),
}));

import { usePopupSyncSelectionHandoff } from '@viewmodels/conversations/usePopupSyncSelectionHandoff';

function Probe() {
  usePopupSyncSelectionHandoff();
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
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('usePopupSyncSelectionHandoff', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    state.loadingInitialList = true;
    state.replaceSelectedIds.mockReset();
    state.read.mockReset();
    state.subscribe.mockReset();
    state.unsubscribe.mockReset();
    state.listener = null;
    state.subscribe.mockImplementation((listener) => {
      state.listener = listener;
      return state.unsubscribe;
    });
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    cleanupDom();
  });

  it('applies the initial handoff once after bootstrap and does not replay it on later list refreshes', async () => {
    state.read.mockResolvedValue([1, 2]);

    await act(async () => {
      root!.render(createElement(Probe));
      await Promise.resolve();
    });
    expect(state.read).toHaveBeenCalledTimes(1);
    expect(state.subscribe).toHaveBeenCalledTimes(1);
    expect(state.replaceSelectedIds).not.toHaveBeenCalled();

    state.loadingInitialList = false;
    act(() => root!.render(createElement(Probe)));
    expect(state.replaceSelectedIds).toHaveBeenCalledTimes(1);
    expect(state.replaceSelectedIds).toHaveBeenLastCalledWith([1, 2]);

    state.loadingInitialList = true;
    act(() => root!.render(createElement(Probe)));
    state.loadingInitialList = false;
    act(() => root!.render(createElement(Probe)));
    expect(state.read).toHaveBeenCalledTimes(1);
    expect(state.subscribe).toHaveBeenCalledTimes(1);
    expect(state.replaceSelectedIds).toHaveBeenCalledTimes(1);
  });

  it('lets a newer storage event win over a slower initial read, then applies later events immediately', async () => {
    let resolveRead!: (value: number[]) => void;
    state.read.mockReturnValue(new Promise((resolve) => (resolveRead = resolve)));

    act(() => root!.render(createElement(Probe)));
    act(() => state.listener?.([9, 10]));

    await act(async () => {
      resolveRead([1, 2]);
      await Promise.resolve();
    });

    expect(state.replaceSelectedIds).not.toHaveBeenCalled();
    state.loadingInitialList = false;
    act(() => root!.render(createElement(Probe)));
    expect(state.replaceSelectedIds).toHaveBeenCalledTimes(1);
    expect(state.replaceSelectedIds).toHaveBeenLastCalledWith([9, 10]);

    act(() => state.listener?.([11]));
    expect(state.replaceSelectedIds).toHaveBeenCalledTimes(2);
    expect(state.replaceSelectedIds).toHaveBeenLastCalledWith([11]);
  });
});
