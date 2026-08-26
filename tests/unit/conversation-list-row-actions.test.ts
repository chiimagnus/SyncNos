import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ReactDOM from 'react-dom/client';
import { act, createElement } from 'react';

import { ConversationListPane } from '../../src/ui/conversations/ConversationListPane';

const getConversationDetailMock = vi.fn();
const formatConversationMarkdownMock = vi.fn();
const writeTextToClipboardMock = vi.fn();
const tabsCreateMock = vi.fn();
const getEnabledSyncProvidersMock = vi.fn();
let currentState: any = null;

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
  formatConversationTitle: (text: string) => text,
  getCurrentLocale: () => 'en',
}));

vi.mock('../../src/services/conversations/client/repo', () => ({
  getConversationDetail: (...args: any[]) => getConversationDetailMock(...args),
}));

vi.mock('../../src/services/integrations/chatwith/chatwith-settings', () => ({
  formatConversationMarkdownForExternalOutput: (...args: any[]) => formatConversationMarkdownMock(...args),
}));

vi.mock('../../src/services/shared/clipboard', () => ({
  writeTextToClipboard: (...args: any[]) => writeTextToClipboardMock(...args),
}));

vi.mock('../../src/services/shared/webext', () => ({
  tabsCreate: (...args: any[]) => tabsCreateMock(...args),
  openOrFocusExtensionAppTab: vi.fn(),
}));

vi.mock('../../src/services/shared/storage', () => ({
  storageOnChanged: () => () => {},
}));

vi.mock('../../src/services/sync/sync-provider-gate', () => ({
  getEnabledSyncProviders: () => getEnabledSyncProvidersMock(),
  syncProviderEnabledStorageKey: (provider: string) => `sync_provider_enabled.${provider}`,
}));

vi.mock('../../src/services/sync/sync-provider-registry', () => ({
  getSyncProviderDefinition: (provider: string) => ({ id: provider, labelKey: `provider.${provider}` }),
  listSyncProviders: () => [{ id: 'notion' }, { id: 'obsidian' }, { id: 'feishu' }],
}));

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => currentState,
}));

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
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  delete (globalThis as any).alert;
}

function buildState() {
  const conversation = {
    id: 11,
    title: 'Row action chat',
    source: 'chatgpt',
    conversationKey: 'conv-11',
    lastCapturedAt: Date.now(),
    url: 'https://example.com/chat/11',
  };
  return {
    conversation,
    state: {
      items: [conversation],
      activeId: 11,
      selectedIds: [],
      toggleAll: vi.fn(),
      toggleSelected: vi.fn(),
      setActiveId: vi.fn(),
      clearSelected: vi.fn(),
      openConversationInListScopeById: vi.fn(),
      exporting: false,
      listError: null,
      syncFeedback: { provider: null, phase: 'idle', total: 0, done: 0, failures: [], message: '', updatedAt: 0, summary: null },
      syncingNotion: false,
      syncingObsidian: false,
      syncingFeishu: false,
      deleting: false,
      listSourceFilterKey: 'all',
      listSiteFilterKey: 'all',
      listSummary: { totalCount: 1, todayCount: 1 },
      listFacets: { sources: [{ key: 'chatgpt', label: 'chatgpt', count: 1 }], sites: [] },
      listHasMore: false,
      loadingInitialList: false,
      loadingMoreList: false,
      setListSourceFilterKeyPersistent: vi.fn(),
      setListSiteFilterKeyPersistent: vi.fn(),
      pendingListLocateId: null,
      consumeListLocate: vi.fn(() => null),
      loadMoreList: vi.fn(async () => {}),
      exportSelectedMarkdown: vi.fn(),
      syncSelectedNotion: vi.fn(),
      syncSelectedObsidian: vi.fn(),
      syncSelectedFeishu: vi.fn(),
      clearSyncFeedback: vi.fn(),
      deleteSelected: vi.fn(),
      refreshList: vi.fn(async () => {}),
    },
  };
}

function flushMicrotasks() {
  return Promise.resolve().then(() => undefined);
}

describe('ConversationListPane row actions', () => {
  let root: ReactDOM.Root | null = null;
  let conversation: any;
  let onOpenConversation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    setupDom();
    vi.clearAllMocks();
    const built = buildState();
    conversation = built.conversation;
    currentState = built.state;
    onOpenConversation = vi.fn();
    getConversationDetailMock.mockResolvedValue({ conversationId: 11, messages: [] });
    formatConversationMarkdownMock.mockResolvedValue('# exact markdown\n');
    writeTextToClipboardMock.mockResolvedValue(true);
    getEnabledSyncProvidersMock.mockResolvedValue(['notion']);
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
      await flushMicrotasks();
    });
    root = null;
    vi.useRealTimers();
    cleanupDom();
  });

  async function renderPane() {
    await act(async () => {
      root!.render(createElement(ConversationListPane, { onOpenConversation }));
      await flushMicrotasks();
    });
  }

  it('copies full markdown through the shared clipboard and keeps row activation isolated', async () => {
    await renderPane();
    const copyButton = document.querySelector('[aria-label="copyFullMarkdown"]') as HTMLButtonElement | null;
    expect(copyButton).toBeTruthy();
    expect(document.querySelector('[aria-label="openOriginalChat"]')).toBeTruthy();
    expect(copyButton?.textContent).toBe('⧉');

    await act(async () => {
      copyButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(getConversationDetailMock).toHaveBeenCalledWith(11);
    expect(formatConversationMarkdownMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: conversation.id, conversationKey: conversation.conversationKey }),
      expect.objectContaining({ conversationId: 11 }),
    );
    expect(writeTextToClipboardMock).toHaveBeenCalledWith('# exact markdown\n');
    expect(copyButton?.textContent).toBe('✓');
    expect(currentState.setActiveId).not.toHaveBeenCalled();
    expect(onOpenConversation).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1100);
      await flushMicrotasks();
    });
    expect(copyButton?.textContent).toBe('⧉');
  });

  it('opens the exact trimmed original https URL without activating the row', async () => {
    currentState.items[0].url = '  https://example.com/path?x=1#section  ';
    await renderPane();
    const openButton = document.querySelector('[aria-label="openOriginalChat"]') as HTMLButtonElement | null;
    expect(openButton).toBeTruthy();
    expect(openButton?.disabled).toBe(false);

    await act(async () => {
      openButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(tabsCreateMock).toHaveBeenCalledWith({ url: 'https://example.com/path?x=1#section' });
    expect(currentState.setActiveId).not.toHaveBeenCalled();
    expect(onOpenConversation).not.toHaveBeenCalled();
  });

  it('keeps http original URLs available', async () => {
    currentState.items[0].url = ' http://example.com/path#hash ';
    await renderPane();
    const openButton = document.querySelector('[aria-label="openOriginalChat"]') as HTMLButtonElement | null;

    await act(async () => {
      openButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(tabsCreateMock).toHaveBeenCalledWith({ url: 'http://example.com/path#hash' });
  });

  it.each(['', 'javascript:alert(1)', 'obsidian://open?vault=x'])('disables Open original for %s', async (url) => {
    currentState.items[0].url = url;
    await renderPane();
    const openButton = document.querySelector('[aria-label="openOriginalChat"]') as HTMLButtonElement | null;

    expect(openButton).toBeTruthy();
    expect(openButton?.disabled).toBe(true);
    expect(tabsCreateMock).not.toHaveBeenCalled();
  });

  it('reports clipboard failure without showing a copied state', async () => {
    const alertSpy = vi.fn();
    Object.defineProperty(globalThis, 'alert', { configurable: true, value: alertSpy });
    writeTextToClipboardMock.mockResolvedValue(false);
    await renderPane();
    const copyButton = document.querySelector('[aria-label="copyFullMarkdown"]') as HTMLButtonElement | null;

    await act(async () => {
      copyButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(alertSpy).toHaveBeenCalledWith('copyFailed');
    expect(copyButton?.textContent).toBe('⧉');
    expect(currentState.setActiveId).not.toHaveBeenCalled();
    expect(onOpenConversation).not.toHaveBeenCalled();
  });
});
