import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scene = vi.hoisted(() => ({
  openBySourceKey: vi.fn(async () => false),
  openSettings: vi.fn(),
}));

vi.mock('@i18n', () => ({ t: (key: string) => key }));
vi.mock('@ui/shared/hooks/useIsNarrowScreen', () => ({ useIsNarrowScreen: () => false }));
vi.mock('@ui/shared/hooks/useNarrowListDetailCommentsRoute', () => ({
  useNarrowListDetailCommentsRoute: () => ({
    route: 'list',
    openDetail: vi.fn(),
    openComments: vi.fn(),
    returnToDetail: vi.fn(),
    returnToList: vi.fn(),
    listRestoreKey: 0,
  }),
}));
vi.mock('@ui/conversations/pending-open', () => ({ consumePendingOpenConversation: () => null }));
vi.mock('@ui/conversations/ConversationListPane', () => ({
  ConversationListPane: () => createElement('div', { 'data-underlying-list': '' }, 'list'),
}));
vi.mock('@ui/conversations/ConversationDetailPane', () => ({
  ConversationDetailPane: () => createElement('div', { 'data-underlying-detail': '' }, 'detail'),
}));
vi.mock('@ui/conversations/ConversationSearchSheet', () => ({
  ConversationSearchSheet: () => createElement('div', { 'data-search-sheet': '' }, 'search'),
}));
vi.mock('@ui/conversations/ArticleCommentsSection', () => ({
  ArticleCommentsSection: () => createElement('div', { 'data-comments': '' }, 'comments'),
}));
vi.mock('@viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => ({
    selectedConversation: null,
    openConversationExternalBySourceKey: scene.openBySourceKey,
    listFacets: { sources: [], sites: [] },
    listErrorCode: 'MIGRATION_FAILED',
    localSearchSheet: {
      capabilityLoading: false,
      mode: 'closed',
      close: vi.fn(),
    },
  }),
}));

import { ConversationsScene } from '@ui/conversations/ConversationsScene';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'chrome-extension://hmgjflllphdffeocddjjcfllifhejpok/app.html',
    pretendToBeVisual: true,
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    delete (globalThis as any)[key];
  }
}

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('conversation scene migration failure state', () => {
  let root: ReactDOM.Root;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    scene.openSettings.mockReset();
    scene.openBySourceKey.mockReset().mockResolvedValue(false);
  });

  afterEach(async () => {
    act(() => root.unmount());
    await flush();
    cleanupDom();
  });

  it('replaces list/detail fallbacks with one lifecycle state and routes recovery to Local Database settings', async () => {
    act(() => root.render(createElement(ConversationsScene, { onOpenSettingsSection: scene.openSettings })));
    await act(async () => flush());

    const failure = document.querySelector('[data-local-data-migration-failed]');
    expect(failure).not.toBeNull();
    expect(failure?.textContent).toContain('localDatabaseMigrationFailedTitle');
    expect(failure?.textContent).toContain('localDatabaseMigrationUnavailableBody');
    expect(document.querySelector('[data-underlying-list]')).toBeNull();
    expect(document.querySelector('[data-underlying-detail]')).toBeNull();

    const button = failure?.querySelector('button') as HTMLButtonElement;
    act(() => button.click());
    expect(scene.openSettings).toHaveBeenCalledWith('backup');
  });
});
