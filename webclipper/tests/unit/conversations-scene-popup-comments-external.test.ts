import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const openCommentsMock = vi.fn();
const openExternalMock = vi.fn();
const sidebarOpenMock = vi.fn();

vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: () => true,
}));

vi.mock('../../src/ui/shared/hooks/useNarrowListDetailCommentsRoute', () => ({
  useNarrowListDetailCommentsRoute: () => ({
    route: 'detail',
    openDetail: vi.fn(),
    openComments: (...args: any[]) => openCommentsMock(...args),
    returnToDetail: vi.fn(),
    returnToList: vi.fn(),
    listRestoreKey: 'k',
  }),
}));

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => ({
    selectedConversation: {
      id: 1,
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article:https://example.com/a',
      url: 'https://example.com/a',
      title: 'A',
    },
    openConversationExternalBySourceKey: vi.fn(),
    openConversationExternalById: vi.fn(),
  }),
}));

vi.mock('../../src/ui/conversations/ConversationListPane', () => ({
  ConversationListPane: () => createElement('div', { 'data-list': '1' }),
}));

vi.mock('../../src/ui/conversations/ArticleCommentsSection', () => ({
  ArticleCommentsSection: () => createElement('div', { 'data-comments': '1' }),
}));

vi.mock('../../src/ui/conversations/ConversationDetailPane', () => ({
  ConversationDetailPane: (props: any) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-detail-comment': '1',
        onClick: () => props?.onTriggerCommentsSidebar?.(),
      },
      'comment',
    ),
}));

import { ConversationsScene } from '../../src/ui/conversations/ConversationsScene';

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
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true,
    value: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event });
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
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).Event;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('ConversationsScene (popup) comments external override', () => {
  it('prefers onOpenCommentsExternally over narrow comments route', () => {
    setupDom();
    openCommentsMock.mockReset();
    openExternalMock.mockReset();
    sidebarOpenMock.mockReset();

    const root = ReactDOM.createRoot(document.getElementById('root')!);
    act(() => {
      root.render(
        createElement(ConversationsScene, {
          inlineNarrowDetailHeader: true,
          onOpenCommentsExternally: () => openExternalMock(),
          commentsSidebarRuntime: {
            sidebarController: { open: (...args: any[]) => sidebarOpenMock(...args) },
            sidebarSnapshot: {},
            sidebarSession: {},
            setLocatorRoot: vi.fn(),
            getLocatorRoot: vi.fn(),
            subscribeSidebarClose: () => () => {},
          },
        } as any),
      );
    });

    const commentBtn = document.querySelector('[data-detail-comment="1"]') as HTMLButtonElement | null;
    expect(commentBtn).toBeTruthy();

    act(() => {
      commentBtn!.click();
    });

    expect(openExternalMock).toHaveBeenCalledTimes(1);
    expect(openCommentsMock).toHaveBeenCalledTimes(0);
    expect(sidebarOpenMock).toHaveBeenCalledTimes(0);

    act(() => {
      root.unmount();
    });
    cleanupDom();
  });
});

