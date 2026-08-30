import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DEFAULT_READER_PREFS } from '../../src/services/protocols/reader-prefs';

const mocks = vi.hoisted(() => {
  const update = vi.fn();
  const play = vi.fn();
  const seek = vi.fn();
  const pause = vi.fn();
  const stop = vi.fn();
  const toggle = vi.fn();
  const outlineEntries: any[] = [];
  return { update, play, seek, pause, stop, toggle, outlineEntries };
});

vi.mock('../../src/viewmodels/reader/useReaderPrefs', () => ({
  useReaderPrefs: () => ({
    prefs: {
      ...DEFAULT_READER_PREFS,
      contentWidth: 2000,
      theme: 'system',
    },
    update: mocks.update,
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
    play: mocks.play,
    seek: mocks.seek,
    pause: mocks.pause,
    stop: mocks.stop,
    toggle: mocks.toggle,
  }),
}));

vi.mock('../../src/ui/reader/ReaderToolbar', () => ({
  ReaderToolbar: ({ outline }: { outline?: { entries?: unknown[] } | null }) =>
    outline?.entries?.length ? createElement('div', { 'data-testid': 'reader-toolbar' }, 'reader-toolbar') : null,
}));

vi.mock('../../src/ui/reader/ArticleOutlineMinimap', () => ({
  useArticleOutlineMinimap: () => ({
    entries: mocks.outlineEntries,
    activeIndex: mocks.outlineEntries.length ? 0 : null,
  }),
}));

vi.mock('../../src/ui/reader/ReaderHeaderToolbar', () => ({
  ReaderHeaderToolbar: () => createElement('div', { 'data-testid': 'reader-header-toolbar' }, 'reader-header-toolbar'),
}));

vi.mock('../../src/ui/shared/ChatMessageBubble', () => ({
  ChatMessageBubble: ({ markdown }: { markdown?: string }) =>
    createElement(
      'article',
      { 'data-testid': 'chat-message' },
      String(markdown || '')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
          if (line.startsWith('### ')) return createElement('h3', { key: `${index}-${line}` }, line.slice(4));
          if (line.startsWith('## ')) return createElement('h2', { key: `${index}-${line}` }, line.slice(3));
          if (line.startsWith('# ')) return createElement('h1', { key: `${index}-${line}` }, line.slice(2));
          return createElement('p', { key: `${index}-${line}` }, line);
        }),
    ),
}));

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
}));

import { ArticleReaderView } from '../../src/ui/conversations/views/ArticleReaderView';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
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
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

async function flushDom(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function renderArticle(root: ReactDOM.Root) {
  act(() => {
    root.render(
      createElement(ArticleReaderView, {
        selected: { id: 42, title: 'Article' },
        activeId: 42,
        detail: {
          conversationId: 42,
          messages: [{ id: 'm-1', role: 'assistant', contentMarkdown: 'Alpha sentence.' }],
        },
        listError: null,
        loadingDetail: false,
        detailError: null,
        setMessagesRootRef: vi.fn(),
        metadata: createElement('div', { 'data-testid': 'detail-metadata' }, 'metadata'),
        readerFeatures: { textLayout: true, theme: true, narration: false },
      }),
    );
  });
}

describe('ArticleReaderView layout', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    mocks.update.mockReset();
    mocks.play.mockReset();
    mocks.seek.mockReset();
    mocks.pause.mockReset();
    mocks.stop.mockReset();
    mocks.toggle.mockReset();
    mocks.outlineEntries.length = 0;
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('renders the article shell without reader controls when no header portal target exists', () => {
    renderArticle(root!);

    const shell = document.querySelector('[data-reader-shell="article"]') as HTMLElement | null;
    expect(shell).toBeTruthy();
    expect(shell?.className).toContain('tw-flex');
    expect(shell?.className).toContain('tw-items-start');
    expect(shell?.style.getPropertyValue('--reader-content-width')).toBe('2000px');
    expect(shell?.hasAttribute('data-reader-theme')).toBe(false);

    const main = shell?.querySelector('[data-reader-main="article-main"]') as HTMLElement | null;
    const rail = shell?.querySelector('[data-reader-rail="article-rail"]') as HTMLElement | null;
    const sentenceRoot = shell?.querySelector('[data-reader-sentence-root="true"]') as HTMLElement | null;
    const metadataColumn = shell?.querySelector('[data-reader-metadata-column="true"]') as HTMLElement | null;

    expect(main).toBeTruthy();
    expect(main?.className).toContain('tw-flex-1');
    expect(rail).toBeNull();
    expect(shell?.querySelector('[data-testid="reader-header-toolbar"]')).toBeNull();
    expect(metadataColumn).toBeTruthy();
    expect(metadataColumn?.querySelector('[data-testid="detail-metadata"]')).toBeTruthy();
    expect(metadataColumn?.style.maxWidth).toBe('var(--reader-content-width)');
    expect(sentenceRoot).toBeTruthy();
    expect(sentenceRoot?.style.maxWidth).toBe('var(--reader-content-width)');
    expect(sentenceRoot?.contains(metadataColumn!)).toBe(false);
    expect(metadataColumn?.contains(sentenceRoot!)).toBe(false);
  });

  it('portals reader controls to More and keeps the outline rail in the reader sticky anchor', async () => {
    const headerTarget = document.createElement('div');
    headerTarget.setAttribute('data-reader-header-toolbar-slot', 'true');
    document.body.appendChild(headerTarget);
    mocks.outlineEntries.push({
      index: 0,
      level: 1,
      id: 'heading-1',
      title: 'Heading',
      element: document.createElement('h1'),
      rect: { top: 0, bottom: 24 },
    });

    act(() => {
      root!.render(
        createElement(ArticleReaderView, {
          selected: { id: 42, title: 'Article' },
          activeId: 42,
          detail: {
            conversationId: 42,
            messages: [{ id: 'm-1', role: 'assistant', contentMarkdown: '# Heading\n\nAlpha sentence.' }],
          },
          listError: null,
          loadingDetail: false,
          detailError: null,
          setMessagesRootRef: vi.fn(),
          readerFeatures: { textLayout: true, theme: true, narration: true },
          readerToolbarPortalTarget: headerTarget,
          outlineScrollRoot: document.body,
        }),
      );
    });

    await flushDom();

    expect(headerTarget.querySelector('[data-testid="reader-header-toolbar"]')).toBeTruthy();
    const shell = document.querySelector('[data-reader-shell="article"]') as HTMLElement | null;
    expect(shell?.querySelector('[data-testid="reader-header-toolbar"]')).toBeNull();
    const outlineAnchor = shell?.querySelector('[data-detail-outline-anchor="true"]') as HTMLElement | null;
    const rail = outlineAnchor?.querySelector('[data-reader-rail="article-rail"]') as HTMLElement | null;
    expect(outlineAnchor).toBeTruthy();
    expect(outlineAnchor?.className).toContain('tw-sticky');
    expect(rail).toBeTruthy();
    expect(rail?.querySelector('[data-testid="reader-toolbar"]')).toBeTruthy();
  });
});
