import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationsScene } from '../../src/ui/conversations/ConversationsScene';

const mocks = vi.hoisted(() => ({
  listCopy: vi.fn(),
  detailCopy: vi.fn(async () => {}),
  narrow: true,
  route: 'list' as 'list' | 'detail',
  activeId: 11 as number | null,
  detailAvailable: true,
}));

vi.mock('../../src/services/shared/storage', () => ({
  storageGet: async () => ({ in_app_shortcuts_v1: { 'copy-markdown': 'Ctrl+Alt+M' } }),
  storageOnChanged: () => () => {},
}));
vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => mocks.narrow,
}));
vi.mock('../../src/ui/shared/hooks/useNarrowListDetailCommentsRoute', () => ({
  useNarrowListDetailCommentsRoute: () => ({
    route: mocks.route,
    openDetail: vi.fn(),
    openComments: vi.fn(),
    returnToDetail: vi.fn(),
    returnToList: vi.fn(),
    listRestoreKey: 0,
  }),
}));
vi.mock('../../src/ui/conversations/ConversationListPane', () => ({
  ConversationListPane: () =>
    createElement(
      'div',
      { 'data-conversation-list-pane': 'true' },
      createElement(
        'div',
        { 'data-conversation-id': '11' },
        createElement('button', { 'data-list-copy-markdown': 'true', onClick: mocks.listCopy }, 'Copy list'),
      ),
    ),
}));
vi.mock('../../src/ui/conversations/LazyConversationSurfaces', () => ({
  LazyConversationDetailPane: () => createElement('button', { 'data-detail-focus': 'true' }, 'Detail'),
  LazyArticleCommentsSection: () => null,
}));
vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => ({
    activeId: mocks.activeId,
    selectedConversation: { id: 11, source: 'chatgpt', conversationKey: 'example', url: 'https://example.com' },
    detailHeaderActions: mocks.detailAvailable
      ? [{ id: 'copy-full-markdown', disabled: false, onTrigger: mocks.detailCopy }]
      : [],
    openConversationExternalById: vi.fn(),
    openConversationExternalBySourceKey: vi.fn(),
    setDetailSurfaceActive: vi.fn(),
  }),
}));

let dom: JSDOM;
let root: ReactDOM.Root;

function pressCopy(target: EventTarget = document) {
  const event = new window.KeyboardEvent('keydown', {
    key: 'm',
    code: 'KeyM',
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

async function render() {
  await act(async () => {
    root.render(createElement(ConversationsScene));
    await Promise.resolve();
  });
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/app',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  Object.defineProperty(dom.window.navigator, 'platform', { configurable: true, value: 'Win32' });
  mocks.narrow = true;
  mocks.route = 'list';
  mocks.activeId = 11;
  mocks.detailAvailable = true;
  mocks.listCopy.mockReset();
  mocks.detailCopy.mockReset().mockResolvedValue(undefined);
  root = ReactDOM.createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
    delete (globalThis as any)[key];
  }
});

describe('one markdown shortcut across list and detail', () => {
  it('copies the list row on the narrow list route and the detail on the narrow detail route', async () => {
    await render();
    expect(pressCopy().defaultPrevented).toBe(true);
    expect(mocks.listCopy).toHaveBeenCalledTimes(1);
    expect(mocks.detailCopy).not.toHaveBeenCalled();

    mocks.route = 'detail';
    await render();
    expect(pressCopy().defaultPrevented).toBe(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.detailCopy).toHaveBeenCalledTimes(1);
    expect(mocks.listCopy).toHaveBeenCalledTimes(1);
  });

  it('uses focused pane in wide layout and never copies twice per keypress', async () => {
    mocks.narrow = false;
    await render();
    const listButton = document.querySelector<HTMLButtonElement>('[data-list-copy-markdown]')!;
    listButton.focus();
    expect(pressCopy(listButton).defaultPrevented).toBe(true);
    expect(mocks.listCopy).toHaveBeenCalledTimes(1);
    expect(mocks.detailCopy).not.toHaveBeenCalled();

    const detailButton = document.querySelector<HTMLButtonElement>('[data-detail-focus]')!;
    detailButton.focus();
    expect(pressCopy(detailButton).defaultPrevented).toBe(true);
    expect(mocks.listCopy).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.detailCopy).toHaveBeenCalledTimes(1);
  });

  it('does not start concurrent detail copies and recovers when a copy completes', async () => {
    let finish!: () => void;
    mocks.route = 'detail';
    mocks.detailCopy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    expect(pressCopy().defaultPrevented).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.detailCopy).toHaveBeenCalledTimes(1);
    expect(pressCopy().defaultPrevented).toBe(false);
    expect(mocks.detailCopy).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pressCopy().defaultPrevented).toBe(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.detailCopy).toHaveBeenCalledTimes(2);
  });

  it('reports copy failures and releases the guard for the next attempt', async () => {
    const alert = vi.fn();
    Object.defineProperty(window, 'alert', { configurable: true, value: alert });
    mocks.route = 'detail';
    mocks.detailCopy.mockRejectedValueOnce(new Error('Copy failed'));
    await render();
    expect(pressCopy().defaultPrevented).toBe(true);
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
    expect(alert).toHaveBeenCalledWith('Copy failed');
    expect(pressCopy().defaultPrevented).toBe(true);
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
    expect(mocks.detailCopy).toHaveBeenCalledTimes(2);
  });

  it('does not consume a key when neither pane has a copyable item', async () => {
    mocks.activeId = null;
    mocks.detailAvailable = false;
    await render();
    expect(pressCopy().defaultPrevented).toBe(false);
    expect(mocks.listCopy).not.toHaveBeenCalled();

    mocks.route = 'detail';
    await render();
    expect(pressCopy().defaultPrevented).toBe(false);
    expect(mocks.detailCopy).not.toHaveBeenCalled();
  });
});
