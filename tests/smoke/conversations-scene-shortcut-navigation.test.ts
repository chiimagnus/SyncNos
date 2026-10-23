import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const narrow = { value: false };
const fixture = {
  activeId: 11 as number | null,
  selectedIds: [] as number[],
  items: [
    { id: 11, source: 'chatgpt', conversationKey: 'c-11', title: 'First' },
    { id: 22, source: 'chatgpt', conversationKey: 'c-22', title: 'Second' },
    { id: 33, source: 'chatgpt', conversationKey: 'c-33', title: 'Third' },
  ],
};
const activateLoadedConversation = vi.fn();
const setDetailSurfaceActive = vi.fn();

vi.mock('@ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => narrow.value,
}));
vi.mock('@ui/conversations/ConversationListPane', () => ({
  ConversationListPane: () => createElement('div', { 'data-test-list': 'true' }),
}));
vi.mock('@ui/conversations/LazyConversationSurfaces', () => ({
  LazyConversationDetailPane: () => createElement('div', { 'data-test-detail': 'true' }),
  LazyArticleCommentsSection: () => createElement('div', { 'data-test-comments': 'true' }),
}));
vi.mock('@ui/conversations/pending-open', () => ({
  consumePendingOpenConversation: () => null,
}));
vi.mock('@viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => ({
    ...fixture,
    selectedConversation: fixture.items.find((item) => item.id === fixture.activeId) || null,
    activateLoadedConversation,
    setDetailSurfaceActive,
    openConversationExternalById: vi.fn(),
    openConversationExternalBySourceKey: vi.fn(),
  }),
}));
vi.mock('@services/shared/storage', () => ({
  storageGet: async () => ({
    in_app_shortcuts_v3: {
      'previous-conversation': 'Alt+Shift+K',
      'next-conversation': 'Alt+Shift+J',
    },
  }),
  storageOnChanged: () => () => {},
}));

import { ConversationsScene } from '@ui/conversations/ConversationsScene';

let dom: JSDOM;
let root: ReactDOM.Root | null;

function shortcut(key: 'j' | 'k') {
  const event = new window.KeyboardEvent('keydown', {
    key,
    code: 'Key' + key.toUpperCase(),
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => document.dispatchEvent(event));
  return event;
}

async function render() {
  await act(async () => {
    root!.render(createElement(ConversationsScene));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  root = ReactDOM.createRoot(document.getElementById('root')!);
  narrow.value = false;
  fixture.activeId = 11;
  fixture.selectedIds = [];
  activateLoadedConversation.mockReset();
  setDetailSurfaceActive.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  dom.window.close();
  for (const name of [
    'window',
    'document',
    'navigator',
    'Element',
    'HTMLElement',
    'Node',
    'IS_REACT_ACT_ENVIRONMENT',
  ]) {
    delete (globalThis as Record<string, unknown>)[name];
  }
});

describe('previous and next conversation shortcuts', () => {
  it('navigates the current loaded list in order, without wrapping at its edges', async () => {
    await render();
    expect(shortcut('k').defaultPrevented).toBe(false);
    expect(activateLoadedConversation).not.toHaveBeenCalled();
    expect(shortcut('j').defaultPrevented).toBe(true);
    expect(activateLoadedConversation).toHaveBeenLastCalledWith(22);

    fixture.activeId = 22;
    await render();
    expect(shortcut('k').defaultPrevented).toBe(true);
    expect(activateLoadedConversation).toHaveBeenLastCalledWith(11);
    expect(shortcut('j').defaultPrevented).toBe(true);
    expect(activateLoadedConversation).toHaveBeenLastCalledWith(33);

    fixture.activeId = 33;
    await render();
    expect(shortcut('j').defaultPrevented).toBe(false);
    expect(activateLoadedConversation).toHaveBeenCalledTimes(3);
  });

  it('does not navigate when selecting multiple rows or when the active item is outside the list', async () => {
    fixture.selectedIds = [11, 22];
    await render();
    expect(shortcut('j').defaultPrevented).toBe(false);
    fixture.selectedIds = [];
    fixture.activeId = 999;
    await render();
    expect(shortcut('k').defaultPrevented).toBe(false);
    expect(activateLoadedConversation).not.toHaveBeenCalled();
  });

  it('starts at the first or last loaded item when there is no active conversation', async () => {
    fixture.activeId = null;
    await render();
    expect(shortcut('j').defaultPrevented).toBe(true);
    expect(activateLoadedConversation).toHaveBeenLastCalledWith(11);
    expect(shortcut('k').defaultPrevented).toBe(true);
    expect(activateLoadedConversation).toHaveBeenLastCalledWith(33);
  });

  it('opens the detail view on narrow screens and keeps navigation within that view', async () => {
    narrow.value = true;
    await render();
    expect(document.querySelector('[data-test-list]')).toBeTruthy();
    expect(shortcut('j').defaultPrevented).toBe(true);
    expect(activateLoadedConversation).toHaveBeenLastCalledWith(22);
    expect(document.querySelector('[data-test-detail]')).toBeTruthy();
    fixture.activeId = 22;
    await render();
    expect(shortcut('k').defaultPrevented).toBe(true);
    expect(activateLoadedConversation).toHaveBeenLastCalledWith(11);
    expect(document.querySelector('[data-test-detail]')).toBeTruthy();
  });
});
