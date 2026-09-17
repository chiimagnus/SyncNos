import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { buildReaderOutlineDomEntries, type ReaderOutlineDomEntry } from '../../src/ui/reader/article-outline-dom';
import { ArticleOutlineMinimap, useArticleOutlineMinimap } from '../../src/ui/reader/ArticleOutlineMinimap';
import { readerOutlineLevelToMinimapWidth } from '../../src/services/protocols/reader-outline';

function setupDom(width = 1024, height = 600) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  const raf = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0);
  const caf = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);

  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(dom.window, 'requestAnimationFrame', { configurable: true, value: raf });
  Object.defineProperty(dom.window, 'cancelAnimationFrame', { configurable: true, value: caf });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
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
  delete (globalThis as any).MouseEvent;
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  delete (globalThis as any).__syncnosReaderPerformance;
}

function setRect(
  element: Element,
  rect: { top: number; bottom: number; left?: number; right?: number; width?: number; height?: number },
) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left ?? 0,
      right: rect.right ?? 0,
      width: rect.width ?? Math.max(0, (rect.right ?? 0) - (rect.left ?? 0)),
      height: rect.height ?? Math.max(0, rect.bottom - rect.top),
      x: rect.left ?? 0,
      y: rect.top,
      toJSON() {
        return this;
      },
    }),
  });
}

async function flushDom(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function buildArticleOutline(): { article: HTMLElement; entries: ReaderOutlineDomEntry[] } {
  document.body.insertAdjacentHTML(
    'beforeend',
    `
      <article id="article">
        <h1>深度工作</h1>
        <p>段落</p>
        <h2>第一策略以及一个足够长的章节标题用于验证目录面板最多显示两行</h2>
        <h3>更细策略</h3>
      </article>
    `,
  );

  const article = document.getElementById('article') as HTMLElement;
  const headings = Array.from(article.querySelectorAll('h1, h2, h3')) as HTMLElement[];
  setRect(headings[0], { top: 18, bottom: 54 });
  setRect(headings[1], { top: 126, bottom: 168 });
  setRect(headings[2], { top: 260, bottom: 304 });
  headings.forEach((heading) => {
    Object.defineProperty(heading, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  return {
    article,
    entries: buildReaderOutlineDomEntries(article),
  };
}

describe('ArticleOutlineMinimap', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  function renderHarness(props: {
    entries: ReaderOutlineDomEntry[];
    activeIndex: number | null;
    onPickStripEntry: (entry: ReaderOutlineDomEntry) => void;
    onPickPanelEntry: (entry: ReaderOutlineDomEntry) => void;
  }) {
    act(() => {
      root!.render(
        createElement(ArticleOutlineMinimap, {
          entries: props.entries,
          activeIndex: props.activeIndex,
          narrow: false,
          onPickStripEntry: props.onPickStripEntry,
          onPickPanelEntry: props.onPickPanelEntry,
        }),
      );
    });
  }

  it('tracks headings from the DOM adapter, updates active index on scroll, and cleans up listeners', async () => {
    const { article } = buildArticleOutline();
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    function Harness() {
      const outline = useArticleOutlineMinimap(article);
      return createElement(
        'div',
        {
          'data-testid': 'outline-state',
          'data-count': String(outline.entries.length),
          'data-active': outline.activeIndex == null ? 'null' : String(outline.activeIndex),
        },
        outline.entries.map((entry) =>
          createElement('span', { key: entry.id, 'data-testid': 'outline-entry' }, entry.title),
        ),
      );
    }

    act(() => {
      root!.render(createElement(Harness));
    });

    await flushDom();

    const state = document.querySelector('[data-testid="outline-state"]') as HTMLElement | null;
    expect(state?.dataset.count).toBe('3');
    expect(state?.dataset.active).toBe('1');
    expect(document.querySelectorAll('[data-testid="outline-entry"]')).toHaveLength(3);
    const perf = (globalThis as any).__syncnosReaderPerformance as Record<string, unknown> | undefined;
    expect(Number(perf?.outlineEntries)).toBe(3);
    expect(Number(perf?.outlineRebuildCount)).toBeGreaterThan(0);
    expect(Number(perf?.outlineActiveRecalcCount)).toBeGreaterThan(0);
    expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), expect.objectContaining({ passive: true }));
    expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function), expect.objectContaining({ passive: true }));

    const headings = Array.from(article.querySelectorAll('h1, h2, h3')) as HTMLElement[];
    setRect(headings[0], { top: -320, bottom: -280 });
    setRect(headings[1], { top: -150, bottom: -110 });
    setRect(headings[2], { top: 42, bottom: 86 });

    act(() => {
      window.dispatchEvent(new window.Event('scroll'));
    });

    await flushDom();
    expect(state?.dataset.active).toBe('2');

    act(() => {
      root?.unmount();
    });
    root = null;
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('renders strip widths, opens on hover, and jumps to headings when a minimap item is clicked', async () => {
    const { entries } = buildArticleOutline();
    const onPickStripEntry = vi.fn();
    const onPickPanelEntry = vi.fn((entry: ReaderOutlineDomEntry) => {
      entry.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    renderHarness({
      entries,
      activeIndex: 1,
      onPickStripEntry,
      onPickPanelEntry,
    });

    const strip = document.querySelector('[data-reader-rail-wrap="outline"]') as HTMLElement | null;
    expect(strip).toBeTruthy();

    const firstStripBar = document.querySelector(
      '[data-reader-rail-wrap="outline"] [data-reader-outline-level="lvl-1"] span',
    ) as HTMLSpanElement | null;
    const secondStripBar = document.querySelector(
      '[data-reader-rail-wrap="outline"] [data-reader-outline-level="lvl-2"] span',
    ) as HTMLSpanElement | null;
    const thirdStripBar = document.querySelector(
      '[data-reader-rail-wrap="outline"] [data-reader-outline-level="lvl-3"] span',
    ) as HTMLSpanElement | null;
    expect(firstStripBar?.style.width).toBe(`${readerOutlineLevelToMinimapWidth(1)}px`);
    expect(secondStripBar?.style.width).toBe(`${readerOutlineLevelToMinimapWidth(2)}px`);
    expect(thirdStripBar?.style.width).toBe(`${readerOutlineLevelToMinimapWidth(3)}px`);
    expect(firstStripBar?.className).toContain('tw-h-[2px]');
    expect(secondStripBar?.className).toContain('tw-h-[2px]');
    expect(thirdStripBar?.className).toContain('tw-h-[2px]');
    const activeStripButton = document.querySelector(
      '[data-reader-rail-wrap="outline"] [data-reader-outline-level="lvl-2"]',
    ) as HTMLButtonElement | null;
    expect(activeStripButton?.dataset.readerOutlineActive).toBe('true');

    const stripButton = document.querySelector(
      '[data-reader-rail-wrap="outline"] [data-reader-rail-trigger-shell="outline"] nav button[data-reader-outline-level="lvl-1"]',
    ) as HTMLButtonElement | null;
    expect(stripButton).toBeTruthy();

    act(() => {
      stripButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onPickStripEntry).toHaveBeenCalledTimes(1);
    expect(onPickPanelEntry).toHaveBeenCalledTimes(0);

    act(() => {
      strip!.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    });
    await flushDom();

    const panel = document.querySelector('[data-reader-rail-panel="outline"]') as HTMLElement | null;
    const triggerShell = strip?.querySelector('[data-reader-rail-trigger-shell="outline"]') as HTMLElement | null;
    expect(panel).toBeTruthy();
    expect(panel?.style.right).toBe('0px');
    expect(panel?.style.top).toBe('0px');
    expect(triggerShell?.getAttribute('aria-hidden')).toBe('true');
    expect(triggerShell?.style.visibility).toBe('hidden');
    expect(panel?.querySelectorAll('[data-reader-outline-entry]')).toHaveLength(3);
    const activePanelItem = panel?.querySelector(
      '[data-reader-outline-active="true"][data-reader-outline-level="lvl-2"]',
    ) as HTMLButtonElement | null;
    expect(activePanelItem).toBeTruthy();
    expect(activePanelItem?.classList.contains('webclipper-btn')).toBe(true);
    expect(activePanelItem?.classList.contains('webclipper-btn--menu-item')).toBe(true);
    expect(activePanelItem?.getAttribute('aria-checked')).toBe('true');

    const longHeading = '第一策略以及一个足够长的章节标题用于验证目录面板最多显示两行';
    const panelButtons = Array.from(panel?.querySelectorAll('button') || []) as HTMLButtonElement[];
    const secondPanelButton = panelButtons.find((button) => button.textContent === longHeading);
    expect(secondPanelButton).toBeTruthy();
    const secondPanelLabel = panel?.querySelector(
      '[data-reader-outline-entry-label="reader-outline-2"]',
    ) as HTMLElement | null;
    expect(secondPanelLabel?.textContent).toBe(longHeading);
    expect(secondPanelLabel?.getAttribute('style')).toContain('-webkit-line-clamp: 2');

    act(() => {
      secondPanelButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onPickStripEntry).toHaveBeenCalledTimes(1);
    expect(onPickPanelEntry).toHaveBeenCalledTimes(1);
    expect(entries[1]?.element.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(document.querySelector('[data-reader-rail-panel="outline"]')).toBeNull();
  });

  it('returns null when no headings are available', () => {
    renderHarness({
      entries: [],
      activeIndex: null,
      onPickStripEntry: vi.fn(),
      onPickPanelEntry: vi.fn(),
    });

    expect(document.querySelector('[data-reader-rail-wrap="outline"]')).toBeNull();
    expect(document.getElementById('root')?.innerHTML).toBe('');
  });
});
