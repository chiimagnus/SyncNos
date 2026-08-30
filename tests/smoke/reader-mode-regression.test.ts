import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DEFAULT_READER_PREFS, DEFAULT_READER_TTS_PREFS } from '../../src/services/protocols/reader-prefs';

const currentState = {
  activeId: 11,
  listError: null as string | null,
  loadingDetail: false,
  detailError: null as string | null,
  detail: {
    conversationId: 11,
    messages: [],
  },
  selectedConversation: {
    id: 11,
    title: 'Conversation',
    source: 'chatgpt',
    sourceType: 'chat',
    conversationKey: 'conv-11',
    notionPageId: '01234567-89ab-cdef-0123-456789abcdef',
  },
  detailHeaderActions: [] as any[],
};

const currentReaderPrefs = {
  ...DEFAULT_READER_PREFS,
  theme: 'system' as const,
  tts: {
    ...DEFAULT_READER_TTS_PREFS,
    engine: 'ai' as const,
    aiEndpoint: 'http://localhost:8880/v1',
    aiApiKey: '',
    aiModel: 'kokoro',
    aiVoice: 'af_sky',
    aiFormat: 'opus' as const,
  },
};

vi.mock('../../src/ui/shared/ChatMessageBubble', () => ({
  ChatMessageBubble: ({ markdown }: { markdown?: string }) => {
    const lines = String(markdown || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return createElement('div', null, 'message');

    return createElement(
      'div',
      null,
      lines.map((line, index) => {
        if (line.startsWith('### ')) return createElement('h3', { key: `${index}-${line}` }, line.slice(4));
        if (line.startsWith('## ')) return createElement('h2', { key: `${index}-${line}` }, line.slice(3));
        if (line.startsWith('# ')) return createElement('h1', { key: `${index}-${line}` }, line.slice(2));
        return createElement('p', { key: `${index}-${line}` }, line);
      }),
    );
  },
}));

vi.mock('../../src/ui/shared/SelectMenu', () => ({
  SelectMenu: ({
    ariaLabel,
    value,
    options,
    onChange,
  }: {
    ariaLabel: string;
    value: string;
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    onChange: (next: string) => void;
  }) =>
    createElement(
      'select',
      {
        'aria-label': ariaLabel,
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      },
      options.map((option) =>
        createElement(
          'option',
          {
            key: option.value,
            value: option.value,
            disabled: option.disabled ?? false,
          },
          option.label,
        ),
      ),
    ),
}));

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
  formatConversationTitle: (value?: string) => String(value || 'Untitled'),
}));

vi.mock('../../src/viewmodels/conversations/conversations-context', () => ({
  useConversationsApp: () => currentState,
}));

vi.mock('../../src/viewmodels/reader/useReaderPrefs', () => ({
  useReaderPrefs: () => ({
    prefs: currentReaderPrefs,
    update: vi.fn(),
  }),
}));

vi.mock('../../src/viewmodels/reader/useReaderNarration', () => ({
  useReaderNarration: () => ({
    state: 'idle' as const,
    activeIndex: -1,
    activeSentence: null,
    hasCursor: false,
    error: null,
    webSpeechAvailable: true,
    isPlaying: false,
    play: vi.fn(),
    seek: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
  }),
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
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: dom.window.MouseEvent });
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: dom.window.KeyboardEvent });
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
  delete (globalThis as any).Element;
  delete (globalThis as any).Node;
  delete (globalThis as any).MouseEvent;
  delete (globalThis as any).KeyboardEvent;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

function resetState() {
  currentState.activeId = 11;
  currentState.listError = null;
  currentState.loadingDetail = false;
  currentState.detailError = null;
  currentState.detail = {
    conversationId: 11,
    messages: [],
  };
  currentState.selectedConversation = {
    id: 11,
    title: 'Conversation',
    source: 'chatgpt',
    sourceType: 'chat',
    conversationKey: 'conv-11',
    notionPageId: '01234567-89ab-cdef-0123-456789abcdef',
  };
  currentState.detailHeaderActions = [];
  currentReaderPrefs.theme = 'system';
  currentReaderPrefs.tts = {
    ...DEFAULT_READER_TTS_PREFS,
    engine: 'ai',
    aiEndpoint: 'http://localhost:8880/v1',
    aiApiKey: '',
    aiModel: 'kokoro',
    aiVoice: 'af_sky',
    aiFormat: 'opus',
  };
}

async function flushDom(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForSelector(selector: string, attempts = 8): Promise<Element | null> {
  for (let index = 0; index < attempts; index += 1) {
    const found = document.querySelector(selector);
    if (found) return found;
    await flushDom();
  }
  return document.querySelector(selector);
}

function renderRoot(root: ReactDOM.Root) {
  act(() => {
    root.render(createElement(ConversationDetailPane));
  });
}

describe('reader mode regression', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    resetState();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('shows the reader shell for article and video detail modes, portals reader controls into More, and keeps the outline minimap visible only when headings exist', async () => {
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
          contentMarkdown: '# 深度工作\n\n## 为什么它稀缺\n\n### 更细策略',
        },
      ],
    } as any;

    renderRoot(root!);
    await flushDom();

    const shell = document.querySelector('[data-reader-shell="article"]') as HTMLElement | null;
    expect(shell).toBeTruthy();
    expect(document.querySelector('[data-reader-sentence-index]')).toBeNull();
    expect(shell?.hasAttribute('data-reader-theme')).toBe(false);
    const articleMoreButton = document.querySelector(
      '[data-detail-header-more-trigger="true"]',
    ) as HTMLButtonElement | null;
    expect(articleMoreButton).toBeTruthy();
    act(() => {
      articleMoreButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushDom();
    expect(document.querySelector('[data-reader-header-toolbar-slot="true"]')).toBeTruthy();
    expect(document.querySelector('[data-reader-header-toolbar="true"]')).toBeTruthy();
    expect(await waitForSelector('[data-reader-rail-wrap="outline"]')).toBeTruthy();
    const articleOutlineSlot = document.querySelector('[data-reader-outline-toolbar-slot]');
    expect(articleOutlineSlot).toBeTruthy();
    expect(articleOutlineSlot?.querySelector('[data-reader-rail-wrap="outline"]')).toBeTruthy();
    expect(shell?.querySelector('[data-reader-header-toolbar="true"]')).toBeNull();

    currentState.selectedConversation = {
      id: 12,
      title: 'Video',
      source: 'web',
      sourceType: 'video',
      conversationKey: 'video-12',
      url: 'https://example.com/video',
    } as any;

    renderRoot(root!);
    await flushDom();

    expect(document.querySelector('[data-reader-shell="article"]')).toBeTruthy();
    const videoMoreButton = document.querySelector(
      '[data-detail-header-more-trigger="true"]',
    ) as HTMLButtonElement | null;
    expect(videoMoreButton).toBeTruthy();
    act(() => {
      videoMoreButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushDom();
    expect(document.querySelector('[data-reader-header-toolbar="true"]')).toBeTruthy();
    expect(await waitForSelector('[data-reader-rail-wrap="outline"]')).toBeTruthy();

    currentState.selectedConversation = {
      id: 13,
      title: 'Chat',
      source: 'chatgpt',
      sourceType: 'chat',
      conversationKey: 'chat-13',
      url: '',
    } as any;
    currentState.detail = {
      conversationId: 13,
      messages: [{ id: 'm-2', role: 'assistant', contentMarkdown: 'No reader rail here.' }],
    } as any;

    renderRoot(root!);
    await flushDom();

    expect(document.querySelector('[data-reader-header-toolbar="true"]')).toBeFalsy();
  });

  it('hides the outline minimap when article detail has no headings', async () => {
    currentState.selectedConversation = {
      id: 21,
      title: 'Article',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-21',
      url: 'https://example.com/article-21',
    } as any;
    currentState.detail = {
      conversationId: 21,
      messages: [{ id: 'm-3', role: 'assistant', contentMarkdown: 'Just a paragraph.' }],
    } as any;

    renderRoot(root!);
    await flushDom();

    expect(document.querySelector('[data-reader-shell="article"]')).toBeTruthy();
    expect(document.querySelector('[data-reader-rail-wrap="outline"]')).toBeNull();
  });

  it('keeps the narration panel AI controls reachable', async () => {
    currentState.selectedConversation = {
      id: 31,
      title: 'Article',
      source: 'web',
      sourceType: 'article',
      conversationKey: 'article-31',
      url: 'https://example.com/article-31',
    } as any;
    currentState.detail = {
      conversationId: 31,
      messages: [{ id: 'm-4', role: 'assistant', contentMarkdown: '# Heading\n\nBody paragraph.' }],
    } as any;

    renderRoot(root!);
    await flushDom();

    const moreButton = document.querySelector('[data-detail-header-more-trigger="true"]') as HTMLButtonElement | null;
    expect(moreButton).toBeTruthy();

    act(() => {
      moreButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushDom();

    const narrationTrigger = document.querySelector(
      '[data-reader-header-trigger="narration"]',
    ) as HTMLButtonElement | null;
    expect(narrationTrigger).toBeTruthy();

    act(() => {
      narrationTrigger!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushDom();

    expect(document.querySelector('[aria-label="readerNarrationModelAria"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="readerNarrationFormatAria"]')).toBeTruthy();
  });
});
