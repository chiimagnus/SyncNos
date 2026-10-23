import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationsScene } from '../../src/ui/conversations/ConversationsScene';

const mocks = vi.hoisted(() => ({
  copyMarkdown: vi.fn(async (_id: number) => {}),
  copyOriginalLink: vi.fn(async (_id: number) => {}),
  exportMarkdown: vi.fn(async (_id: number) => {}),
  deleteItem: vi.fn(async (_id: number) => {}),
  listButtonClick: vi.fn(),
  narrow: true,
  route: 'list' as 'list' | 'detail' | 'comments',
  activeId: 11 as number | null,
  selectedId: 11 as number | null,
  originalUrl: 'https://example.com/original',
  exporting: false,
  deleting: false,
}));

vi.mock('../../src/services/shared/storage', () => ({
  storageGet: async () => ({
    in_app_shortcuts_v2: {
      'copy-markdown': 'Ctrl+Alt+M',
      'copy-original-link': 'Ctrl+Alt+L',
      'export-item': 'Ctrl+Alt+E',
      'delete-item': 'Ctrl+Alt+D',
    },
  }),
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
        createElement('button', { 'data-list-copy-markdown': 'true', onClick: mocks.listButtonClick }, 'List button'),
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
    items: mocks.activeId
      ? [
          {
            id: 11,
            title: 'Example item',
            source: 'chatgpt',
            conversationKey: 'example',
            url: mocks.originalUrl,
          },
        ]
      : [],
    selectedConversation: mocks.selectedId
      ? {
          id: mocks.selectedId,
          title: 'Example item',
          source: 'chatgpt',
          conversationKey: 'example',
          url: mocks.originalUrl,
        }
      : null,
    exporting: mocks.exporting,
    deleting: mocks.deleting,
    copyConversationMarkdown: mocks.copyMarkdown,
    copyConversationSourceLink: mocks.copyOriginalLink,
    exportConversationMarkdown: mocks.exportMarkdown,
    deleteConversation: mocks.deleteItem,
    openConversationExternalById: vi.fn(),
    openConversationExternalBySourceKey: vi.fn(),
    setDetailSurfaceActive: vi.fn(),
  }),
}));

let dom: JSDOM;
let root: ReactDOM.Root;
function key(code: string, target: EventTarget = document) {
  const event = new window.KeyboardEvent('keydown', {
    key: code.slice(-1).toLowerCase(),
    code,
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => target.dispatchEvent(event));
  return event;
}
async function settled() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function render() {
  await act(async () => {
    root.render(createElement(ConversationsScene));
    await Promise.resolve();
    await Promise.resolve();
  });
}
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/app',
    pretendToBeVisual: true,
  });
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, name, { configurable: true, value });
  Object.defineProperty(dom.window.navigator, 'platform', { configurable: true, value: 'Win32' });
  mocks.narrow = true;
  mocks.route = 'list';
  mocks.activeId = 11;
  mocks.selectedId = 11;
  mocks.originalUrl = 'https://example.com/original';
  mocks.exporting = false;
  mocks.deleting = false;
  for (const fn of [
    mocks.copyMarkdown,
    mocks.copyOriginalLink,
    mocks.exportMarkdown,
    mocks.deleteItem,
    mocks.listButtonClick,
  ]) {
    fn.mockReset();
  }
  mocks.copyMarkdown.mockResolvedValue(undefined);
  mocks.copyOriginalLink.mockResolvedValue(undefined);
  mocks.exportMarkdown.mockResolvedValue(undefined);
  mocks.deleteItem.mockResolvedValue(undefined);
  root = ReactDOM.createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  for (const name of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'])
    delete (globalThis as any)[name];
});

describe('shortcuts perform actions on the current item', () => {
  it('copies Markdown by ID on narrow list and detail without clicking a list button', async () => {
    await render();
    expect(key('KeyM').defaultPrevented).toBe(true);
    await settled();
    expect(mocks.copyMarkdown).toHaveBeenCalledWith(11);
    expect(mocks.listButtonClick).not.toHaveBeenCalled();

    mocks.route = 'detail';
    await render();
    expect(key('KeyM').defaultPrevented).toBe(true);
    await settled();
    expect(mocks.copyMarkdown).toHaveBeenCalledTimes(2);
    expect(mocks.listButtonClick).not.toHaveBeenCalled();
  });

  it('uses the focused pane in wide layout and executes only once', async () => {
    mocks.narrow = false;
    await render();
    const list = document.querySelector<HTMLButtonElement>('[data-list-copy-markdown]')!;
    list.focus();
    expect(key('KeyM', list).defaultPrevented).toBe(true);
    await settled();
    expect(mocks.copyMarkdown).toHaveBeenCalledTimes(1);

    const detail = document.querySelector<HTMLButtonElement>('[data-detail-focus]')!;
    detail.focus();
    expect(key('KeyM', detail).defaultPrevented).toBe(true);
    await settled();
    expect(mocks.copyMarkdown).toHaveBeenCalledTimes(2);
    expect(mocks.listButtonClick).not.toHaveBeenCalled();
  });

  it('copies the original link for the current item and ignores invalid URLs', async () => {
    await render();
    expect(key('KeyL').defaultPrevented).toBe(true);
    await settled();
    expect(mocks.copyOriginalLink).toHaveBeenCalledWith(11);
    mocks.originalUrl = 'javascript:alert(1)';
    await render();
    expect(key('KeyL').defaultPrevented).toBe(false);
    expect(mocks.copyOriginalLink).toHaveBeenCalledTimes(1);
  });

  it('exports the current item, not the multi-selection, and confirms deletion', async () => {
    await render();
    expect(key('KeyE').defaultPrevented).toBe(true);
    await settled();
    expect(mocks.exportMarkdown).toHaveBeenCalledWith(11);

    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    Object.defineProperty(window, 'confirm', { configurable: true, value: confirm });
    expect(key('KeyD').defaultPrevented).toBe(true);
    expect(mocks.deleteItem).not.toHaveBeenCalled();
    expect(key('KeyD').defaultPrevented).toBe(true);
    await settled();
    expect(mocks.deleteItem).toHaveBeenCalledWith(11);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(mocks.listButtonClick).not.toHaveBeenCalled();
  });

  it('does not consume keys without a target or in a comments-only route', async () => {
    mocks.activeId = null;
    mocks.selectedId = null;
    await render();
    for (const code of ['KeyM', 'KeyL', 'KeyE', 'KeyD']) {
      expect(key(code).defaultPrevented).toBe(false);
    }
    expect(mocks.copyMarkdown).not.toHaveBeenCalled();
    expect(mocks.exportMarkdown).not.toHaveBeenCalled();
    expect(mocks.deleteItem).not.toHaveBeenCalled();

    mocks.route = 'comments';
    mocks.activeId = 11;
    mocks.selectedId = 11;
    await render();
    expect(key('KeyD').defaultPrevented).toBe(false);
  });

  it('blocks overlapping mutations and releases the guard after completion or failure', async () => {
    let complete!: () => void;
    mocks.copyMarkdown.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    await render();
    expect(key('KeyM').defaultPrevented).toBe(true);
    await settled();
    expect(key('KeyE').defaultPrevented).toBe(false);
    expect(mocks.exportMarkdown).not.toHaveBeenCalled();
    await act(async () => {
      complete();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(key('KeyE').defaultPrevented).toBe(true);
    await settled();
    expect(mocks.exportMarkdown).toHaveBeenCalledTimes(1);

    const alert = vi.fn();
    Object.defineProperty(window, 'alert', { configurable: true, value: alert });
    mocks.copyMarkdown.mockRejectedValueOnce(new Error('copy failed'));
    expect(key('KeyM').defaultPrevented).toBe(true);
    await settled();
    expect(alert).toHaveBeenCalledWith('copy failed');
    expect(key('KeyM').defaultPrevented).toBe(true);
    await settled();
    expect(mocks.copyMarkdown).toHaveBeenCalledTimes(3);
  });
});
