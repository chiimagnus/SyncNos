import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DEFAULT_READER_PREFS } from '../../src/services/protocols/reader-prefs';
import type { ReaderTtsSentence } from '../../src/services/reader/tts/reader-tts-engine';
import * as readerSentenceDom from '../../src/ui/reader/reader-sentence-dom';

const narrationState = {
  state: 'idle' as 'idle' | 'loading' | 'playing' | 'paused',
  activeIndex: -1,
  activeSentence: null as ReaderTtsSentence | null,
  hasCursor: false,
  error: null as string | null,
  webSpeechAvailable: true,
  isPlaying: false,
};

const outlineState = {
  entries: [] as any[],
  activeIndex: null as number | null,
};

const mocks = vi.hoisted(() => {
  const play = vi.fn();
  const seek = vi.fn();
  const pause = vi.fn();
  const stop = vi.fn();
  const toggle = vi.fn();
  const update = vi.fn();
  const sources: string[] = [];
  return { play, seek, pause, stop, toggle, update, sources };
});

vi.mock('../../src/viewmodels/reader/useReaderPrefs', () => ({
  useReaderPrefs: () => ({
    prefs: DEFAULT_READER_PREFS,
    update: mocks.update,
  }),
}));

vi.mock('../../src/ui/reader/ArticleOutlineMinimap', () => ({
  useArticleOutlineMinimap: () => outlineState,
}));

vi.mock('../../src/services/shared/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/shared/storage')>()),
  storageGet: async () => ({ in_app_shortcuts_v3: { 'reader-play-pause': 'Alt+Shift+R' } }),
  storageOnChanged: () => () => {},
}));

vi.mock('../../src/viewmodels/reader/useReaderNarration', () => ({
  useReaderNarration: (source: string) => {
    mocks.sources.push(source);
    return {
      ...narrationState,
      play: mocks.play,
      seek: mocks.seek,
      pause: mocks.pause,
      stop: mocks.stop,
      toggle: mocks.toggle,
    };
  },
}));

vi.mock('../../src/ui/reader/ReaderToolbar', () => ({
  ReaderToolbar: ({ features, narration }: any) => {
    if (!features.narration) return null;
    return createElement(
      'div',
      { 'data-testid': 'reader-toolbar' },
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'toolbar-play',
          onClick: () => narration.play(),
        },
        'play',
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'toolbar-toggle',
          onClick: () => narration.toggle(),
        },
        'toggle',
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'toolbar-stop',
          onClick: () => narration.stop(),
        },
        'stop',
      ),
    );
  },
}));

import { ArticleReaderView } from '../../src/ui/conversations/views/ArticleReaderView';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  const raf = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0);
  const caf = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);

  Object.defineProperty(dom.window, 'requestAnimationFrame', { configurable: true, value: raf });
  Object.defineProperty(dom.window, 'cancelAnimationFrame', { configurable: true, value: caf });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'Text', { configurable: true, value: dom.window.Text });
  Object.defineProperty(globalThis, 'Range', { configurable: true, value: dom.window.Range });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: dom.window.MouseEvent });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: dom.window.MutationObserver });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: raf });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: caf });
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
  delete (globalThis as any).Text;
  delete (globalThis as any).Range;
  delete (globalThis as any).MouseEvent;
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  delete (globalThis as any).__syncnosReaderPerformance;
}

function installManualRaf() {
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  const requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  const cancelAnimationFrame = (id: number) => {
    queue.delete(id);
  };

  Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: requestAnimationFrame });
  Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: cancelAnimationFrame });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: requestAnimationFrame });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: cancelAnimationFrame });

  return {
    async flushNext(): Promise<boolean> {
      let ran = false;
      await act(async () => {
        const next = queue.entries().next();
        if (next.done) return;
        const [id, cb] = next.value;
        queue.delete(id);
        cb(Date.now());
        ran = true;
        await Promise.resolve();
      });
      return ran;
    },
    async flushUntil(predicate: () => boolean, maxFrames = 12): Promise<void> {
      await act(async () => {
        for (let index = 0; index < maxFrames; index += 1) {
          if (predicate()) return;
          const next = queue.entries().next();
          if (next.done) {
            await Promise.resolve();
            continue;
          }
          const [id, cb] = next.value;
          queue.delete(id);
          cb(Date.now());
          await Promise.resolve();
        }
      });
    },
    async flushAll(maxFrames = 24): Promise<void> {
      await act(async () => {
        for (let index = 0; index < maxFrames; index += 1) {
          const next = queue.entries().next();
          if (next.done) return;
          const [id, cb] = next.value;
          queue.delete(id);
          cb(Date.now());
          await Promise.resolve();
        }
      });
    },
  };
}

function resetMocks() {
  mocks.play.mockReset();
  mocks.seek.mockReset();
  mocks.pause.mockReset();
  mocks.stop.mockReset();
  mocks.toggle.mockReset();
  mocks.update.mockReset();
  outlineState.entries = [];
  outlineState.activeIndex = null;
  mocks.sources.length = 0;
  Object.assign(narrationState, {
    state: 'idle',
    activeIndex: -1,
    activeSentence: null,
    hasCursor: false,
    error: null,
    webSpeechAvailable: true,
    isPlaying: false,
  });
  delete (globalThis as any).__syncnosReaderPerformance;
}

function normalizeText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderArticle(
  root: ReactDOM.Root,
  markdown = 'Alpha sentence with [link](https://example.com). Beta sentence.',
  overrides: Partial<Parameters<typeof ArticleReaderView>[0]> = {},
) {
  const detail = {
    messages: [{ id: 1, role: 'assistant', contentMarkdown: markdown, conversationId: 42 }],
  };
  act(() => {
    root.render(
      createElement(ArticleReaderView, {
        selected: { id: 42 },
        activeId: 42,
        detail,
        listError: null,
        loadingDetail: false,
        detailError: null,
        setMessagesRootRef: () => {},
        readerFeatures: { textLayout: true, theme: true, narration: true },
        ...overrides,
      }),
    );
  });
}

function getSentenceRoot(): HTMLElement {
  const root = document.querySelector('[data-reader-sentence-root="true"]') as HTMLElement | null;
  if (!root) throw new Error('sentence root not found');
  return root;
}

function getSentenceSpans(): HTMLElement[] {
  return Array.from(getSentenceRoot().querySelectorAll<HTMLElement>('[data-reader-sentence-index]'));
}

async function flushDom(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForSentenceCount(expected: number): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) {
      if (getSentenceSpans().length === expected) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  });
}

describe('ArticleReaderView sentence interactions', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    resetMocks();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('toggles actual narration via the configured shortcut only for ready article content', async () => {
    const press = () => {
      const event = new window.KeyboardEvent('keydown', {
        key: 'r',
        code: 'KeyR',
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => document.dispatchEvent(event));
      return event;
    };

    renderArticle(root!);
    await flushDom();
    expect(press().defaultPrevented).toBe(true);
    expect(mocks.toggle).toHaveBeenCalledTimes(1);
    expect(mocks.toggle).toHaveBeenCalledWith(0);

    Object.assign(narrationState, { state: 'paused', isPlaying: false });
    renderArticle(root!);
    await flushDom();
    expect(press().defaultPrevented).toBe(true);
    expect(mocks.toggle).toHaveBeenCalledTimes(2);

    renderArticle(root!, 'Another paragraph.', { loadingDetail: true });
    await flushDom();
    expect(press().defaultPrevented).toBe(false);
    renderArticle(root!, 'Another paragraph.', { loadingDetail: false, activeId: 99 });
    await flushDom();
    expect(press().defaultPrevented).toBe(false);
    renderArticle(root!, 'Another paragraph.', {
      activeId: 42,
      readerFeatures: { textLayout: true, theme: true, narration: false },
    });
    await flushDom();
    expect(press().defaultPrevented).toBe(false);
    expect(mocks.toggle).toHaveBeenCalledTimes(2);
  });

  it('decorates sentences only after narration is engaged and keeps spans stable across rerender', async () => {
    renderArticle(root!);
    await flushDom();

    expect(getSentenceSpans()).toHaveLength(0);

    Object.assign(narrationState, {
      state: 'playing',
      activeIndex: 0,
      activeSentence: { index: 0, text: 'Alpha sentence with link.', start: 0, end: 26 },
      hasCursor: true,
      isPlaying: true,
    });
    renderArticle(root!);
    await waitForSentenceCount(2);

    const rootNode = getSentenceRoot();
    const spans = getSentenceSpans();
    expect(spans).toHaveLength(2);
    expect(spans.map((span) => span.getAttribute('data-reader-sentence-index'))).toEqual(['0', '1']);
    expect(spans[0].classList.contains('reader-tts-sentence-active')).toBe(true);
    expect(normalizeText(mocks.sources[mocks.sources.length - 1])).toBe('Alpha sentence with link. Beta sentence.');

    const snapshot = rootNode.innerHTML;
    renderArticle(root!);
    await flushDom();
    expect(getSentenceRoot().innerHTML).toBe(snapshot);
    expect(getSentenceSpans()).toHaveLength(2);
  });

  it('collects sentence text segments once per decoration pass', async () => {
    const collectSpy = vi.spyOn(readerSentenceDom, 'collectReaderSentenceTextSegments');

    Object.assign(narrationState, {
      state: 'loading',
      activeIndex: -1,
      activeSentence: null,
      hasCursor: false,
      isPlaying: true,
    });
    renderArticle(root!);
    await waitForSentenceCount(2);

    expect(getSentenceSpans()).toHaveLength(2);
    expect(collectSpy).toHaveBeenCalledTimes(1);
  });

  it('progressively decorates long documents instead of wrapping every sentence in the first frame', async () => {
    const raf = installManualRaf();
    const markdown = Array.from({ length: 140 }, (_, index) => `Sentence ${index + 1}.`).join(' ');

    Object.assign(narrationState, {
      state: 'loading',
      activeIndex: -1,
      activeSentence: null,
      hasCursor: false,
      isPlaying: true,
    });
    renderArticle(root!, markdown);

    let partialCount = 0;
    for (let index = 0; index < 4; index += 1) {
      const ran = await raf.flushNext();
      if (!ran) break;
      partialCount = getSentenceSpans().length;
      if (partialCount > 0) break;
    }

    expect(partialCount).toBeGreaterThan(0);
    expect(partialCount).toBeLessThan(140);

    await raf.flushAll();
    expect(getSentenceSpans()).toHaveLength(140);

    const perf = (globalThis as any).__syncnosReaderPerformance as Record<string, unknown> | undefined;
    expect(perf?.decorateMode).toBe('progressive');
    expect(Number(perf?.decorateBatches)).toBeGreaterThan(1);
    expect(Number(perf?.sentenceCount)).toBe(140);
    expect(Number(perf?.sourceLength)).toBeGreaterThan(1000);
  });

  it('defers eager sentence decoration for huge idle documents until narration is engaged', async () => {
    const markdown = Array.from({ length: 700 }, (_, index) => `Sentence ${index + 1}.`).join(' ');

    renderArticle(root!, markdown);
    await flushDom();

    expect(getSentenceSpans()).toHaveLength(0);
    expect((globalThis as any).__syncnosReaderPerformance?.decorateMode).toBe('idle');

    Object.assign(narrationState, {
      state: 'loading',
      activeIndex: 0,
      activeSentence: { index: 0, text: 'Sentence 1.', start: 0, end: 11 },
      hasCursor: true,
      isPlaying: true,
    });
    renderArticle(root!, markdown);
    await flushDom();

    expect(getSentenceSpans().length).toBeGreaterThan(0);
  });

  it('clears idle narration cursor decorations instead of leaving clickable highlights visible', async () => {
    Object.assign(narrationState, {
      state: 'playing',
      activeIndex: 0,
      activeSentence: { index: 0, text: 'Alpha sentence with link.', start: 0, end: 26 },
      hasCursor: true,
      isPlaying: true,
    });
    renderArticle(root!);
    await waitForSentenceCount(2);
    expect(getSentenceSpans()[0].classList.contains('reader-tts-sentence-active')).toBe(true);

    Object.assign(narrationState, {
      state: 'idle',
      activeIndex: 0,
      activeSentence: { index: 0, text: 'Alpha sentence with link.', start: 0, end: 26 },
      hasCursor: true,
      isPlaying: false,
    });
    renderArticle(root!);
    await flushDom();

    expect(getSentenceSpans()).toHaveLength(0);
    expect(getSentenceRoot().getAttribute('data-reader-sentence-decoration')).toBeNull();

    const sentenceRoot = getSentenceRoot();
    sentenceRoot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it('ignores sentence clicks while idle, then plays while active, without blocking links', async () => {
    renderArticle(root!);
    await flushDom();

    const sentenceRoot = getSentenceRoot();
    expect(getSentenceSpans()).toHaveLength(0);

    sentenceRoot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(mocks.seek).not.toHaveBeenCalled();
    expect(mocks.play).not.toHaveBeenCalled();

    Object.assign(narrationState, {
      state: 'playing',
      activeIndex: 0,
      activeSentence: { index: 0, text: 'Alpha sentence with link.', start: 0, end: 26 },
      hasCursor: true,
      isPlaying: true,
    });
    renderArticle(root!);
    await waitForSentenceCount(2);

    const spans = getSentenceSpans();
    const firstSentence = spans[0];
    const firstLink = firstSentence.querySelector('a') as HTMLAnchorElement | null;
    expect(firstLink).toBeTruthy();

    firstLink!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(mocks.play).not.toHaveBeenCalled();

    expect(getSentenceSpans()[0].classList.contains('reader-tts-sentence-active')).toBe(true);
    getSentenceSpans()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(mocks.play).toHaveBeenCalledWith(1);
  });

  it('rebuilds spans after DOM mutation and disconnects its observer on unmount', async () => {
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');
    Object.assign(narrationState, {
      state: 'playing',
      activeIndex: 0,
      activeSentence: { index: 0, text: 'Alpha sentence with link.', start: 0, end: 26 },
      hasCursor: true,
      isPlaying: true,
    });
    renderArticle(root!);
    await waitForSentenceCount(2);

    const rootNode = getSentenceRoot();
    expect(getSentenceSpans()).toHaveLength(2);

    rootNode.appendChild(document.createTextNode(' Third sentence.'));
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 220));
    });
    await waitForSentenceCount(3);

    expect(normalizeText(mocks.sources[mocks.sources.length - 1])).toBe(
      'Alpha sentence with link. Beta sentence. Third sentence.',
    );
    expect(getSentenceSpans()).toHaveLength(3);

    act(() => {
      root?.unmount();
    });

    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('does not throw when a progressive decoration cleanup sees spans that were already detached', async () => {
    const raf = installManualRaf();
    const markdown = Array.from({ length: 140 }, (_, index) => `Sentence ${index + 1}.`).join(' ');

    renderArticle(root!, markdown);
    await raf.flushNext();

    const rootNode = getSentenceRoot();
    rootNode.innerHTML = '<p>Replaced by external renderer.</p>';

    await expect(raf.flushAll()).resolves.toBeUndefined();
    expect(rootNode.textContent).toContain('Replaced by external renderer.');
  });
});
