import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const currentState = {
  activeId: 11,
  listError: null,
  loadingDetail: false,
  detailError: null,
  detail: {
    conversationId: 11,
    messages: [],
  },
  selectedConversation: {
    id: 11,
    title: 'Conversation',
    source: 'chatgpt',
    conversationKey: 'conv-11',
    notionPageId: '01234567-89ab-cdef-0123-456789abcdef',
  },
  detailHeaderActions: [
    {
      id: 'open-in-notion',
      label: 'Open in Notion',
      kind: 'external-link' as const,
      provider: 'notion',
      slot: 'open',
      href: 'https://www.notion.so/0123456789abcdef0123456789abcdef',
      onTrigger: vi.fn(async () => {}),
    },
  ],
};

vi.mock('../../src/ui/shared/ChatMessageBubble', () => ({
  ChatMessageBubble: () => createElement('div', null, 'message'),
}));

vi.mock('../../src/ui/conversations/ArticleCommentsSection', () => ({
  ArticleCommentsSection: () => createElement('div', null, 'comments-section'),
}));

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => {
    const labels: Record<string, string> = {
      conversationDetailAria: 'Conversation detail',
      detailTitle: 'Detail',
      selectConversationHint: 'Select a conversation',
      loadingDots: 'Loading...',
      noMessages: 'No messages',
      selectAConversation: 'Select a conversation',
      backButton: 'Back',
      detailHeaderOpenInMenuAria: 'Open destinations',
      messageRoleFallback: 'message',
      openCommentsSidebar: 'Comment',
      closeCommentsSidebar: 'Collapse comments sidebar',
    };
    return labels[key] || key;
  },
  formatConversationTitle: (value?: string) => String(value || 'Untitled'),
}));

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => currentState,
}));

import { ConversationDetailPane } from '../../src/ui/conversations/ConversationDetailPane';

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
  delete (globalThis as any).localStorage;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('ConversationDetailPane header actions', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    currentState.detailHeaderActions = [
      {
        id: 'open-in-notion',
        label: 'Open in Notion',
        provider: 'notion',
        kind: 'external-link',
        slot: 'open',
        href: 'https://www.notion.so/0123456789abcdef0123456789abcdef',
        onTrigger: vi.fn(async () => {}),
      },
    ];
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('shows Open in Notion in the app detail header when the action is available', () => {
    currentState.detailHeaderActions = [
      {
        id: 'open-in-notion',
        label: 'Open in Notion',
        kind: 'external-link',
        provider: 'notion',
        slot: 'open',
        href: 'https://www.notion.so/0123456789abcdef0123456789abcdef',
        onTrigger: vi.fn(async () => {}),
      },
    ];

    act(() => {
      root!.render(createElement(ConversationDetailPane));
    });

    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeTruthy();
  });

  it('hides the app detail action area when no header actions are available', () => {
    currentState.detailHeaderActions = [];

    act(() => {
      root!.render(createElement(ConversationDetailPane));
    });

    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeFalsy();
  });

  it('shows a menu trigger in the app detail header when multiple destinations are available', () => {
    currentState.detailHeaderActions = [
      {
        id: 'open-in-notion',
        label: 'Open in Notion',
        provider: 'notion',
        kind: 'external-link',
        slot: 'open',
        href: 'https://www.notion.so/0123456789abcdef0123456789abcdef',
        onTrigger: vi.fn(async () => {}),
      },
      {
        id: 'open-in-obsidian',
        label: 'Open in Obsidian',
        provider: 'obsidian',
        kind: 'open-target',
        slot: 'open',
        onTrigger: vi.fn(async () => {}),
      },
    ];

    act(() => {
      root!.render(createElement(ConversationDetailPane));
    });

    expect(document.querySelector('[aria-label="Open destinations"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeFalsy();
  });

  it('shows a comments sidebar toggle in article detail mode', () => {
    currentState.selectedConversation = {
      id: 11,
      title: 'Article',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-11',
      url: 'https://example.com/article',
    } as any;
    currentState.detailHeaderActions = [];

    const onTriggerCommentsSidebar = vi.fn();

    act(() => {
      root!.render(createElement(ConversationDetailPane, { onTriggerCommentsSidebar, commentsSidebarOpen: false }));
    });

    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();

    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(onTriggerCommentsSidebar).toHaveBeenCalledTimes(1);
    expect(onTriggerCommentsSidebar).toHaveBeenCalledWith('');

    act(() => {
      root!.render(createElement(ConversationDetailPane, { onTriggerCommentsSidebar, commentsSidebarOpen: true }));
    });

    const pressedBtn = document.querySelector('[aria-label="Comment"][aria-pressed="true"]');
    expect(pressedBtn).toBeTruthy();
  });
});
