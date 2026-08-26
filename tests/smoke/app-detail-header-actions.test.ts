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
      href: 'https://app.notion.com/0123456789abcdef0123456789abcdef',
      onTrigger: vi.fn(async () => {}),
    },
  ] as any[],
};

vi.mock('../../src/ui/shared/ChatMessageBubble', () => ({
  ChatMessageBubble: ({ markdown }: { markdown?: string }) => createElement('div', null, String(markdown || 'message')),
}));

vi.mock('../../src/ui/conversations/ArticleCommentsSection', () => ({
  ArticleCommentsSection: () => createElement('div', null, 'comments-section'),
}));

vi.mock('../../src/services/shared/storage', () => ({
  storageGet: vi.fn(async () => ({})),
  storageOnChanged: () => () => {},
  storageSet: vi.fn(async () => undefined),
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
      readerToolbarAria: 'Reader tools',
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
}

function cleanupDom() {
  // Keep the JSDOM globals around: React may schedule async work that still
  // references `window` after the test has completed. The next `setupDom()`
  // call will overwrite them.
}

function mockSelectionRange(textNode: Text, start: number, end: number): () => void {
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);

  const quote = String(textNode.textContent || '').slice(start, end);
  const selectionMock = {
    rangeCount: 1,
    anchorNode: textNode,
    focusNode: textNode,
    toString: () => quote,
    getRangeAt: () => range,
    removeAllRanges: () => {},
    addRange: () => {},
  } as any;

  const spy = vi.spyOn(globalThis, 'getSelection').mockImplementation(() => selectionMock as Selection);
  return () => spy.mockRestore();
}

function findTextNodeContaining(root: ParentNode, needle: string): Text | null {
  const walker = document.createTreeWalker(root as Node, window.NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (String(node.textContent || '').includes(needle)) return node;
  }
  return null;
}

describe('ConversationDetailPane header actions', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    currentState.selectedConversation = {
      id: 11,
      title: 'Conversation',
      source: 'chatgpt',
      conversationKey: 'conv-11',
      notionPageId: '01234567-89ab-cdef-0123-456789abcdef',
    } as any;
    currentState.detail = {
      conversationId: 11,
      messages: [],
    } as any;
    currentState.detailHeaderActions = [
      {
        id: 'open-in-notion',
        label: 'Open in Notion',
        provider: 'notion',
        kind: 'external-link',
        slot: 'open',
        href: 'https://app.notion.com/0123456789abcdef0123456789abcdef',
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
        href: 'https://app.notion.com/0123456789abcdef0123456789abcdef',
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
        href: 'https://app.notion.com/0123456789abcdef0123456789abcdef',
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

  it('shows Cache images for article detail when tools action is provided', async () => {
    const onTrigger = vi.fn(async () => {});
    currentState.selectedConversation = {
      id: 11,
      title: 'Article',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-11',
      url: 'https://example.com/article',
    } as any;
    currentState.detail = {
      conversationId: 11,
      messages: [
        {
          id: 'm-1',
          role: 'assistant',
          contentMarkdown: 'One two three.',
        },
      ],
    } as any;
    currentState.detailHeaderActions = [
      {
        id: 'cache-images',
        label: 'Cache images',
        provider: 'local',
        kind: 'open-target',
        slot: 'tools',
        onTrigger,
      },
    ];

    act(() => {
      root!.render(createElement(ConversationDetailPane));
    });

    const moreButton = document.querySelector('[data-detail-header-more-trigger="true"]') as HTMLButtonElement | null;
    expect(moreButton).toBeTruthy();

    await act(async () => {
      moreButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const cacheButton = document.querySelector('[aria-label="Cache images"]') as HTMLButtonElement | null;
    expect(cacheButton).toBeTruthy();
    const moreMenu = document.querySelector('[role="menu"][aria-label="moreButton"]') as HTMLElement | null;
    expect(moreMenu).toBeTruthy();
    expect(moreMenu?.className || '').toContain('tw-w-[214px]');
    expect(document.querySelector('[data-detail-word-count-row="true"]')).toBeTruthy();

    await act(async () => {
      cacheButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('renders multiple More tool actions as first-level menu items and closes after trigger', async () => {
    const cacheTrigger = vi.fn(async () => {});
    const copyTrigger = vi.fn(async () => {});
    const openTrigger = vi.fn(async () => {});
    currentState.detailHeaderActions = [
      {
        id: 'cache-images',
        label: 'Cache images',
        provider: 'local',
        kind: 'open-target',
        slot: 'tools',
        onTrigger: cacheTrigger,
      },
      {
        id: 'copy-full-markdown',
        label: 'Copy full Markdown',
        provider: 'local',
        kind: 'copy-text',
        slot: 'tools',
        onTrigger: copyTrigger,
      },
      {
        id: 'open-original',
        label: 'Open original',
        provider: 'source',
        kind: 'external-link',
        slot: 'tools',
        disabled: true,
        onTrigger: openTrigger,
      },
    ];

    act(() => {
      root!.render(createElement(ConversationDetailPane));
    });

    const moreButton = document.querySelector('[data-detail-header-more-trigger="true"]') as HTMLButtonElement | null;
    expect(moreButton).toBeTruthy();
    await act(async () => {
      moreButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const moreMenu = document.querySelector('[role="menu"][aria-label="moreButton"]') as HTMLElement | null;
    expect(moreMenu).toBeTruthy();
    const items = Array.from(moreMenu!.querySelectorAll('[role="menuitem"]')) as HTMLButtonElement[];
    expect(items.map((item) => String(item.textContent || '').trim())).toEqual([
      'Cache images',
      'Copy full Markdown',
      'Open original',
    ]);
    expect(moreMenu!.querySelector('[aria-haspopup="menu"]')).toBeFalsy();
    expect(items[2]?.disabled).toBe(true);

    await act(async () => {
      items[1]!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(copyTrigger).toHaveBeenCalledTimes(1);
    expect(cacheTrigger).not.toHaveBeenCalled();
    expect(openTrigger).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"][aria-label="moreButton"]')?.hasAttribute('hidden')).toBe(true);
  });

  it('shows a comments sidebar toggle in article detail mode', async () => {
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

    await act(async () => {
      await Promise.resolve();
    });

    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();
    expect(openBtn?.className || '').toContain('tw-order-2');
    const moreBtn = document.querySelector('[data-detail-header-more-trigger="true"]') as HTMLButtonElement | null;
    expect(moreBtn).toBeTruthy();
    expect(moreBtn?.closest('.tw-order-3')).toBeTruthy();

    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(onTriggerCommentsSidebar).toHaveBeenCalledTimes(1);
    expect(onTriggerCommentsSidebar).toHaveBeenCalledWith();

    act(() => {
      root!.render(createElement(ConversationDetailPane, { onTriggerCommentsSidebar, commentsSidebarOpen: true }));
    });

    const pressedBtn = document.querySelector('[aria-label="Comment"][aria-pressed="true"]');
    expect(pressedBtn).toBeTruthy();
  });

  it('does not pass selected message text or locator when opening comments sidebar', async () => {
    currentState.selectedConversation = {
      id: 13,
      title: 'Article',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-13',
      url: 'https://example.com/article-13',
    } as any;
    currentState.detail = {
      conversationId: 13,
      messages: [{ id: 'm-1', role: 'assistant', contentText: 'Alpha beta gamma' }],
    } as any;
    currentState.detailHeaderActions = [];

    const onTriggerCommentsSidebar = vi.fn();

    act(() => {
      root!.render(createElement(ConversationDetailPane, { onTriggerCommentsSidebar, commentsSidebarOpen: false }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textNode = findTextNodeContaining(document.body, 'Alpha beta gamma');
    expect(textNode).toBeTruthy();

    const full = String(textNode?.textContent || '');
    const start = full.indexOf('beta');
    expect(start).toBeGreaterThanOrEqual(0);
    const restoreSelection = mockSelectionRange(textNode!, start, start + 'beta'.length);

    const openBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();

    act(() => {
      openBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(onTriggerCommentsSidebar).toHaveBeenCalledTimes(1);
    const firstCallArgs = onTriggerCommentsSidebar.mock.calls[0] || [];
    expect(firstCallArgs.length).toBe(0);

    restoreSelection();
  });

  it('keeps the comments toggle in the same header row as title metadata container', async () => {
    currentState.selectedConversation = {
      id: 12,
      title: 'Article',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-12',
      url: 'https://example.com/article-12',
    } as any;
    currentState.detailHeaderActions = [];

    const onTriggerCommentsSidebar = vi.fn();

    act(() => {
      root!.render(createElement(ConversationDetailPane, { onTriggerCommentsSidebar, commentsSidebarOpen: false }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const header = document.querySelector('header');
    expect(header).toBeTruthy();

    const commentsBtn = document.querySelector('[aria-label="Comment"]') as HTMLButtonElement | null;
    expect(commentsBtn).toBeTruthy();
    const title = header?.querySelector('h2');
    expect(title).toBeTruthy();

    const commentsContainer = commentsBtn?.parentElement;
    expect(commentsContainer).toBeTruthy();
    expect(commentsContainer?.className).toContain('tw-whitespace-nowrap');
    expect(commentsContainer?.className).not.toContain('tw-flex-wrap');
    expect(header?.className).not.toContain('tw-flex-col');
  });

  it('shows reader toolbar in the header for article and video detail modes', async () => {
    currentState.detailHeaderActions = [];

    currentState.selectedConversation = {
      id: 15,
      title: 'Article',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-15',
      url: 'https://example.com/article-15',
    } as any;

    act(() => {
      root!.render(createElement(ConversationDetailPane));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const moreButton = document.querySelector('[data-detail-header-more-trigger="true"]') as HTMLButtonElement | null;
    expect(moreButton).toBeTruthy();

    await act(async () => {
      moreButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.querySelector('[data-reader-header-toolbar-slot="true"]')).toBeTruthy();
    expect(document.querySelector('[data-reader-header-toolbar="true"]')).toBeTruthy();
    expect(document.querySelector('[data-reader-shell="article"]')).toBeTruthy();

    currentState.selectedConversation = {
      id: 16,
      title: 'Video',
      source: 'web',
      sourceType: 'video',
      conversationKey: 'video-16',
      url: 'https://example.com/video-16',
    } as any;

    act(() => {
      root!.render(createElement(ConversationDetailPane));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const videoMoreButton = document.querySelector(
      '[data-detail-header-more-trigger="true"]',
    ) as HTMLButtonElement | null;
    expect(videoMoreButton).toBeTruthy();

    await act(async () => {
      videoMoreButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.querySelector('[data-reader-header-toolbar="true"]')).toBeTruthy();
  });

  it('does not show comments toggle when selected conversation is chat', () => {
    currentState.selectedConversation = {
      id: 11,
      title: 'Chat',
      source: 'chatgpt',
      sourceType: 'chat',
      conversationKey: 'chat-11',
      url: '',
    } as any;
    currentState.detailHeaderActions = [];

    act(() => {
      root!.render(createElement(ConversationDetailPane));
    });

    expect(document.querySelector('[aria-label="Comment"]')).toBeFalsy();
    expect(document.querySelector('[role="toolbar"][aria-label="Reader tools"]')).toBeFalsy();
  });

  it('does not show comments toggle when video reuses the article renderer', async () => {
    currentState.selectedConversation = {
      id: 14,
      title: 'Video',
      source: 'web',
      sourceType: 'video',
      conversationKey: 'video-14',
      url: 'https://example.com/video',
    } as any;
    currentState.detailHeaderActions = [];

    act(() => {
      root!.render(createElement(ConversationDetailPane, { onTriggerCommentsSidebar: vi.fn() }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('[aria-label="Comment"]')).toBeFalsy();
  });
});
