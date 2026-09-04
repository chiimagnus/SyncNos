import { JSDOM } from 'jsdom';
import { describe, expect, test, vi } from 'vitest';

import { createCommentRangeMarkerRegistry } from '../../src/ui/comments/range-marker-registry';

function fakeRange(document: Document, left: number): Range {
  return {
    cloneRange: () => fakeRange(document, left),
    getClientRects: () => [{ left, top: 10, right: left + 20, bottom: 20, width: 20, height: 10 }],
  } as unknown as Range;
}

function rect(left: number, width = 20): DOMRect {
  return { left, top: 10, right: left + width, bottom: 20, width, height: 10 } as DOMRect;
}

function textRange(document: Document, text: Text, start = 0, end = text.data.length): Range {
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  return range;
}

function installTextRangeGeometry(
  dom: JSDOM,
  textRects: ReadonlyMap<Text, readonly DOMRect[] | (() => readonly DOMRect[])>,
  wholeRangeRects: readonly DOMRect[] = [],
) {
  const wholeRangeCalls = vi.fn(() => wholeRangeRects);
  const renderedTextRanges: Array<{ node: Text; start: number; end: number }> = [];
  Object.defineProperty(dom.window.Range.prototype, 'getClientRects', {
    configurable: true,
    value(this: Range) {
      if (this.startContainer !== this.endContainer || this.startContainer.nodeType !== 3) return wholeRangeCalls();
      const node = this.startContainer as Text;
      renderedTextRanges.push({ node, start: this.startOffset, end: this.endOffset });
      const source = textRects.get(node);
      return typeof source === 'function' ? source() : source || [];
    },
  });
  return { wholeRangeCalls, renderedTextRanges };
}

describe('comment range marker registry', () => {
  test('atomically replaces markers for the same comment', () => {
    const dom = new JSDOM('<body></body>', { url: 'https://example.com/' });
    const first = dom.window.document.createTextNode('first');
    const second = dom.window.document.createTextNode('second');
    dom.window.document.body.append(first, second);
    installTextRangeGeometry(
      dom,
      new Map([
        [first, [rect(10)]],
        [second, [rect(30)]],
      ]),
    );
    const registry = createCommentRangeMarkerRegistry({
      document: dom.window.document,
      window: dom.window as unknown as Window,
    });
    registry.replace(1, textRange(dom.window.document, first), dom.window.document.body);
    registry.refresh();
    registry.replace(1, textRange(dom.window.document, second), dom.window.document.body);
    registry.refresh();
    const markers = dom.window.document.querySelectorAll('[data-comment-id="1"]');
    expect(markers).toHaveLength(1);
    expect((markers[0] as HTMLElement).style.left).toBe('30px');
  });

  test('owns document-level geometry and visual styles outside the panel shadow root', () => {
    const dom = new JSDOM('<body><aside id="panel"></aside></body>', { url: 'https://example.com/' });
    const styleSource = dom.window.document.querySelector('#panel')!;
    const text = dom.window.document.createTextNode('marker');
    dom.window.document.body.appendChild(text);
    installTextRangeGeometry(dom, new Map([[text, [rect(10)]]]));
    (styleSource as HTMLElement).style.setProperty('--panel-accent', 'rgb(1 2 3)');
    const registry = createCommentRangeMarkerRegistry({
      document: dom.window.document,
      window: dom.window as unknown as Window,
      styleSource,
    });

    registry.replace(1, textRange(dom.window.document, text), dom.window.document.body);
    registry.refresh();

    const layer = dom.window.document.querySelector('.webclipper-comment-range-markers') as HTMLElement;
    const marker = dom.window.document.querySelector('[data-comment-id="1"]') as HTMLElement;
    expect(layer.style.position).toBe('absolute');
    expect(layer.style.zIndex).toBe('2147483600');
    expect(layer.style.pointerEvents).toBe('none');
    expect(layer.style.getPropertyValue('--webclipper-comment-marker-accent')).toBe('rgb(1 2 3)');
    expect(marker.style.position).toBe('absolute');
    expect(marker.style.pointerEvents).toBe('none');
    expect(marker.style.borderRadius).toBe('0px');
    expect(marker.dataset.tone).toBe('passive');
    expect(marker.style.top).toBe('19px');
    expect(marker.style.height).toBe('1px');
    expect(marker.style.background).toContain('62%');
    expect(marker.style.boxShadow).toBe('');
    expect(marker.style.opacity).toBe('0.78');

    registry.setActive(1);
    registry.refresh();
    const active = dom.window.document.querySelector('[data-comment-id="1"]') as HTMLElement;
    expect(active.dataset.tone).toBe('active');
    expect(active.style.top).toBe('18px');
    expect(active.style.height).toBe('2px');
    expect(active.style.background).toContain('88%');
    expect(active.style.boxShadow).toBe('');
    expect(active.style.opacity).toBe('1');
  });

  test('uses native text highlights for app ranges so browser clipping and stacking stay authoritative', () => {
    const dom = new JSDOM('<html><head></head><body><aside id="panel"></aside><p>hello world</p></body></html>', {
      url: 'https://example.com/',
    });
    const registered = new Map<string, { priority: number; ranges: AbstractRange[] }>();
    class FakeHighlight {
      priority = 0;
      type = 'highlight' as const;
      readonly ranges: AbstractRange[];

      constructor(...ranges: AbstractRange[]) {
        this.ranges = ranges;
      }

      forEach(callback: (value: AbstractRange, key: AbstractRange, parent: Highlight) => void) {
        for (const range of this.ranges) callback(range, range, this as unknown as Highlight);
      }
    }
    Object.defineProperty(dom.window, 'CSS', {
      configurable: true,
      value: {
        highlights: {
          set(name: string, highlight: FakeHighlight) {
            registered.set(name, { priority: highlight.priority, ranges: highlight.ranges });
          },
          delete(name: string) {
            return registered.delete(name);
          },
        },
      },
    });
    Object.defineProperty(dom.window, 'Highlight', { configurable: true, value: FakeHighlight });
    const styleSource = dom.window.document.querySelector('#panel')!;
    (styleSource as HTMLElement).style.setProperty('--panel-accent', 'rgb(1 2 3)');
    const registry = createCommentRangeMarkerRegistry({
      document: dom.window.document,
      window: dom.window as unknown as Window,
      styleSource,
      renderMode: 'native',
    });

    registry.replace(1, fakeRange(dom.window.document, 10), dom.window.document.body);

    expect(dom.window.document.querySelector('.webclipper-comment-range-markers')).toBeNull();
    const style = dom.window.document.querySelector('[data-webclipper-comment-highlights]') as HTMLStyleElement;
    expect(style.textContent).toContain('::highlight(webclipper-comment-passive-');
    expect(style.textContent).toContain('text-decoration-line: underline');
    expect(style.textContent).toContain('text-decoration-thickness: 1px');
    expect(Array.from(registered.keys()).some((name) => name.includes('passive'))).toBe(true);

    registry.setActive(1);
    const active = Array.from(registered.entries()).find(([name]) => name.includes('active'));
    expect(active?.[1].priority).toBe(1);
    expect(active?.[1].ranges).toHaveLength(1);

    registry.dispose();
    expect(registered.size).toBe(0);
    expect(dom.window.document.querySelector('[data-webclipper-comment-highlights]')).toBeNull();
  });

  test('does not fall back to a global overlay when native highlights are unavailable', () => {
    const dom = new JSDOM('<body></body>', { url: 'https://example.com/' });
    const registry = createCommentRangeMarkerRegistry({
      document: dom.window.document,
      window: dom.window as unknown as Window,
      renderMode: 'native',
    });

    registry.replace(1, fakeRange(dom.window.document, 10), dom.window.document.body);

    expect(dom.window.document.querySelector('.webclipper-comment-range-markers')).toBeNull();
    expect(dom.window.document.querySelector('[data-webclipper-comment-highlights]')).toBeNull();
    registry.dispose();
  });

  test('switches active/passive state', () => {
    const dom = new JSDOM('<body></body>', { url: 'https://example.com/' });
    const first = dom.window.document.createTextNode('first');
    const second = dom.window.document.createTextNode('second');
    dom.window.document.body.append(first, second);
    installTextRangeGeometry(
      dom,
      new Map([
        [first, [rect(10)]],
        [second, [rect(20)]],
      ]),
    );
    const registry = createCommentRangeMarkerRegistry({
      document: dom.window.document,
      window: dom.window as unknown as Window,
    });
    registry.replace(1, textRange(dom.window.document, first), dom.window.document.body);
    registry.replace(2, textRange(dom.window.document, second), dom.window.document.body);
    registry.setActive(2);
    registry.refresh();
    expect(dom.window.document.querySelector('[data-comment-id="1"]')?.className).toContain('is-passive');
    expect(dom.window.document.querySelector('[data-comment-id="2"]')?.className).toContain('is-active');
  });

  test('dispose removes listeners, entries, and DOM rects', () => {
    const dom = new JSDOM('<body></body>', { url: 'https://example.com/' });
    const text = dom.window.document.createTextNode('marker');
    dom.window.document.body.appendChild(text);
    installTextRangeGeometry(dom, new Map([[text, [rect(10)]]]));
    const registry = createCommentRangeMarkerRegistry({
      document: dom.window.document,
      window: dom.window as unknown as Window,
    });
    registry.replace(1, textRange(dom.window.document, text), dom.window.document.body);
    registry.refresh();
    registry.dispose();
    expect(registry.size()).toBe(0);
    expect(dom.window.document.querySelector('.webclipper-comment-range-markers')).toBeNull();
  });
  test('renders only text fragments for cross-block and partial ranges', () => {
    const dom = new JSDOM('<body><article><p>alpha <em>beta</em></p><p>gamma</p></article></body>', {
      url: 'https://example.com/',
    });
    const article = dom.window.document.querySelector('article')!;
    const alpha = article.querySelector('p')!.firstChild as Text;
    const beta = article.querySelector('em')!.firstChild as Text;
    const gamma = article.querySelectorAll('p')[1]!.firstChild as Text;
    const geometry = installTextRangeGeometry(
      dom,
      new Map([
        [alpha, [rect(10, 30)]],
        [beta, [rect(50, 24)]],
        [gamma, [rect(10, 40)]],
      ]),
      [rect(10, 30), rect(0, 1000)],
    );
    const wholeRange = dom.window.document.createRange();
    wholeRange.selectNodeContents(article);
    const partialRange = dom.window.document.createRange();
    partialRange.setStart(alpha, 2);
    partialRange.setEnd(beta, 2);
    const registry = createCommentRangeMarkerRegistry({
      document: dom.window.document,
      window: dom.window as unknown as Window,
    });

    registry.replace(1, wholeRange, article);
    registry.replace(2, partialRange, article, 'active');

    const passive = dom.window.document.querySelectorAll('[data-comment-id="1"]');
    const active = dom.window.document.querySelectorAll('[data-comment-id="2"]');
    expect(passive).toHaveLength(3);
    expect(Array.from(passive, (marker) => (marker as HTMLElement).style.width)).toEqual(['30px', '24px', '40px']);
    expect(active).toHaveLength(2);
    expect(Array.from(active, (marker) => (marker as HTMLElement).style.height)).toEqual(['2px', '2px']);
    expect(geometry.wholeRangeCalls).not.toHaveBeenCalled();
    expect(geometry.renderedTextRanges).toContainEqual({ node: alpha, start: 2, end: alpha.data.length });
    expect(geometry.renderedTextRanges).toContainEqual({ node: beta, start: 0, end: 2 });
  });

  test('refreshes geometry from stable resolved roots and disconnects on dispose', () => {
    const dom = new JSDOM('<body><main id="source">marker</main></body>', {
      url: 'https://example.com/',
    });
    const sourceRoot = dom.window.document.querySelector('#source')!;
    const text = sourceRoot.firstChild as Text;
    let left = 10;
    installTextRangeGeometry(dom, new Map([[text, () => [rect(left)]]]));
    const range = textRange(dom.window.document, text);
    const observed: Element[] = [];
    let disconnected = 0;
    let notifyResize = () => {};
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }
      observe(element: Element) {
        observed.push(element);
      }
      unobserve() {}
      disconnect() {
        disconnected += 1;
      }
    }
    Object.defineProperty(dom.window, 'ResizeObserver', {
      configurable: true,
      value: FakeResizeObserver,
    });

    const registry = createCommentRangeMarkerRegistry({
      document: dom.window.document,
      window: dom.window as unknown as Window,
    });
    registry.replace(1, range, sourceRoot);
    registry.refresh();
    expect(dom.window.document.getSelection()?.rangeCount || 0).toBe(0);
    expect(observed).toEqual([dom.window.document.documentElement, sourceRoot]);
    expect((dom.window.document.querySelector('[data-comment-id="1"]') as HTMLElement).style.left).toBe('10px');

    left = 44;
    notifyResize();
    expect((dom.window.document.querySelector('[data-comment-id="1"]') as HTMLElement).style.left).toBe('44px');

    registry.dispose();
    expect(disconnected).toBe(1);
  });
});
