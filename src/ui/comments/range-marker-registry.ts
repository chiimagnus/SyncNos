export type CommentMarkerTone = 'passive' | 'active';

type MarkerEntry = { range: Range; root: Element; tone: CommentMarkerTone; elements: HTMLElement[] };

type NativeHighlightRegistry = {
  set(name: string, highlight: Highlight): unknown;
  delete(name: string): boolean;
};

type NativeHighlightWindow = Window & {
  CSS?: { highlights?: NativeHighlightRegistry };
  Highlight?: new (...ranges: AbstractRange[]) => Highlight;
};

export type CommentRangeMarkerRegistry = {
  replace(commentId: number, range: Range, root: Element, tone?: CommentMarkerTone): void;
  remove(commentId: number): void;
  setActive(commentId: number | null): void;
  refresh(): void;
  dispose(): void;
  size(): number;
};

const MARKER_ACCENT_VAR = '--webclipper-comment-marker-accent';
const DEFAULT_MARKER_ACCENT = 'rgb(255 198 173)';
let nativeHighlightRegistrySequence = 0;

function readMarkerAccent(input: { window?: Window; styleSource?: Element }): string {
  if (!input.styleSource || !input.window?.getComputedStyle) return DEFAULT_MARKER_ACCENT;
  try {
    const styles = input.window.getComputedStyle(input.styleSource);
    return (
      styles.getPropertyValue('--panel-accent').trim() ||
      styles.getPropertyValue('--accent').trim() ||
      DEFAULT_MARKER_ACCENT
    );
  } catch (_error) {
    return DEFAULT_MARKER_ACCENT;
  }
}

function normalizeCssColor(document: Document, value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color || DEFAULT_MARKER_ACCENT;
}

function readNativeHighlightApi(window: Window | undefined) {
  const candidate = window as NativeHighlightWindow | undefined;
  const registry = candidate?.CSS?.highlights;
  const HighlightCtor = candidate?.Highlight;
  if (!registry || typeof registry.set !== 'function' || typeof registry.delete !== 'function') return null;
  if (typeof HighlightCtor !== 'function') return null;
  return { registry, HighlightCtor };
}

function selectedTextRangeRects(document: Document, range: Range): DOMRect[] {
  const textNodes: Text[] = [];
  const ancestor = range.commonAncestorContainer;
  if (ancestor.nodeType === 3) {
    textNodes.push(ancestor as Text);
  } else {
    const walker = document.createTreeWalker(ancestor, 4);
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }
  }

  const rects: DOMRect[] = [];
  for (const textNode of textNodes) {
    if (!textNode.data) continue;
    if (!range.intersectsNode(textNode)) continue;
    const textRange = document.createRange();
    textRange.selectNodeContents(textNode);
    if (range.startContainer === textNode) textRange.setStart(textNode, range.startOffset);
    if (range.endContainer === textNode) textRange.setEnd(textNode, range.endOffset);
    if (textRange.collapsed) continue;
    for (const rect of Array.from(textRange.getClientRects()) as DOMRect[]) {
      if (rect.width > 0 && rect.height > 0) rects.push(rect);
    }
  }
  return rects;
}

export function createCommentRangeMarkerRegistry(input: {
  document: Document;
  window?: Window;
  host?: HTMLElement;
  styleSource?: Element;
  renderMode?: 'overlay' | 'native';
}): CommentRangeMarkerRegistry {
  const doc = input.document;
  const win = input.window || doc.defaultView || undefined;
  const nativeMode = input.renderMode === 'native';
  const nativeApi = nativeMode ? readNativeHighlightApi(win) : null;
  const host = input.host || doc.body || doc.documentElement;
  const layer = nativeMode ? null : doc.createElement('div');
  if (layer) {
    layer.className = 'webclipper-comment-range-markers';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.position = 'absolute';
    layer.style.inset = '0';
    layer.style.zIndex = '2147483600';
    layer.style.pointerEvents = 'none';
    layer.style.setProperty(MARKER_ACCENT_VAR, DEFAULT_MARKER_ACCENT);
    host.appendChild(layer);
  }

  const nativeHighlightId = nativeApi ? ++nativeHighlightRegistrySequence : null;
  const passiveHighlightName = nativeHighlightId ? `webclipper-comment-passive-${nativeHighlightId}` : '';
  const activeHighlightName = nativeHighlightId ? `webclipper-comment-active-${nativeHighlightId}` : '';
  const nativeStyle = nativeApi ? doc.createElement('style') : null;
  if (nativeStyle) {
    nativeStyle.setAttribute('data-webclipper-comment-highlights', String(nativeHighlightId));
    (doc.head || doc.documentElement).appendChild(nativeStyle);
  }

  const entries = new Map<number, MarkerEntry>();
  let activeId: number | null = null;
  let rafId: number | null = null;
  let disposed = false;
  let resizeObserver: ResizeObserver | null = null;
  let observedGeometryRoots = new Set<Element>();
  let nativeAccent = '';

  const syncVisualTokens = () => {
    const sourceAccent = readMarkerAccent({ window: win, styleSource: input.styleSource });
    if (layer) {
      layer.style.setProperty(MARKER_ACCENT_VAR, sourceAccent);
      return;
    }
    const accent = normalizeCssColor(doc, sourceAccent);
    if (!nativeStyle || accent === nativeAccent) return;
    nativeAccent = accent;
    nativeStyle.textContent = `
::highlight(${passiveHighlightName}) {
  text-decoration-line: underline;
  text-decoration-color: color-mix(in srgb, ${accent} 62%, transparent);
  text-decoration-thickness: 1px;
  text-decoration-skip-ink: none;
}
::highlight(${activeHighlightName}) {
  text-decoration-line: underline;
  text-decoration-color: color-mix(in srgb, ${accent} 88%, transparent);
  text-decoration-thickness: 2px;
  text-decoration-skip-ink: none;
}
`;
  };

  const clearElements = (entry: MarkerEntry) => {
    for (const element of entry.elements) element.remove();
    entry.elements = [];
  };

  const applyMarkerStyles = (element: HTMLElement, tone: CommentMarkerTone) => {
    element.style.position = 'absolute';
    element.style.boxSizing = 'border-box';
    element.style.pointerEvents = 'none';
    element.style.borderRadius = '0';
    element.dataset.tone = tone;
    element.style.background = `color-mix(in srgb, var(${MARKER_ACCENT_VAR}) ${tone === 'active' ? '88%' : '62%'}, transparent)`;
    element.style.opacity = tone === 'active' ? '1' : '0.78';
    element.style.transition = 'background-color 120ms ease, opacity 120ms ease';
  };

  const renderOverlayEntry = (commentId: number, entry: MarkerEntry) => {
    if (!layer) return;
    clearElements(entry);
    for (const rect of selectedTextRangeRects(doc, entry.range)) {
      const element = doc.createElement('div');
      element.className = `webclipper-comment-range-marker is-${entry.tone}`;
      element.dataset.commentId = String(commentId);
      applyMarkerStyles(element, entry.tone);
      const thickness = entry.tone === 'active' ? 2 : 1;
      element.style.left = `${rect.left + (win?.scrollX || 0)}px`;
      element.style.top = `${rect.bottom + (win?.scrollY || 0) - thickness}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${thickness}px`;
      layer.appendChild(element);
      entry.elements.push(element);
    }
  };

  const renderNativeHighlights = () => {
    if (!nativeApi) return;
    nativeApi.registry.delete(passiveHighlightName);
    nativeApi.registry.delete(activeHighlightName);
    const passiveRanges: AbstractRange[] = [];
    const activeRanges: AbstractRange[] = [];
    for (const entry of entries.values()) {
      if (entry.tone === 'active') activeRanges.push(entry.range);
      else passiveRanges.push(entry.range);
    }
    if (passiveRanges.length) {
      const highlight = new nativeApi.HighlightCtor(...passiveRanges);
      highlight.priority = 0;
      nativeApi.registry.set(passiveHighlightName, highlight);
    }
    if (activeRanges.length) {
      const highlight = new nativeApi.HighlightCtor(...activeRanges);
      highlight.priority = 1;
      nativeApi.registry.set(activeHighlightName, highlight);
    }
  };

  const syncGeometryObservers = () => {
    if (!layer) return;
    const ResizeObserverCtor = (win as (Window & { ResizeObserver?: typeof ResizeObserver }) | undefined)
      ?.ResizeObserver;
    if (!ResizeObserverCtor) return;
    const nextRoots = entries.size
      ? Array.from(new Set<Element>([doc.documentElement, ...Array.from(entries.values(), (entry) => entry.root)]))
      : [];
    const unchanged =
      nextRoots.length === observedGeometryRoots.size && nextRoots.every((root) => observedGeometryRoots.has(root));
    if (unchanged) return;
    resizeObserver?.disconnect();
    const observer = resizeObserver || new ResizeObserverCtor(() => refresh());
    resizeObserver = observer;
    observedGeometryRoots = new Set(nextRoots);
    for (const root of nextRoots) observer.observe(root);
  };

  const refresh = () => {
    if (disposed) return;
    if (nativeMode) {
      syncVisualTokens();
      renderNativeHighlights();
      return;
    }
    syncGeometryObservers();
    if (rafId != null && win?.cancelAnimationFrame) win.cancelAnimationFrame(rafId);
    const run = () => {
      rafId = null;
      syncVisualTokens();
      for (const [commentId, entry] of entries) renderOverlayEntry(commentId, entry);
    };
    rafId = win?.requestAnimationFrame ? win.requestAnimationFrame(run) : (run(), null);
  };

  const onGeometryChange = () => refresh();
  if (layer) {
    win?.addEventListener('resize', onGeometryChange);
    win?.addEventListener('scroll', onGeometryChange, true);
  }

  return {
    replace(commentId, range, root, tone = commentId === activeId ? 'active' : 'passive') {
      if (disposed) return;
      const previous = entries.get(commentId);
      if (previous) clearElements(previous);
      entries.set(commentId, { range: range.cloneRange(), root, tone, elements: [] });
      refresh();
    },
    remove(commentId) {
      const entry = entries.get(commentId);
      if (!entry) return;
      clearElements(entry);
      entries.delete(commentId);
      if (activeId === commentId) activeId = null;
      refresh();
    },
    setActive(commentId) {
      activeId = commentId;
      for (const [id, entry] of entries) entry.tone = id === commentId ? 'active' : 'passive';
      refresh();
    },
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId != null && win?.cancelAnimationFrame) win.cancelAnimationFrame(rafId);
      if (layer) {
        win?.removeEventListener('resize', onGeometryChange);
        win?.removeEventListener('scroll', onGeometryChange, true);
      }
      resizeObserver?.disconnect();
      resizeObserver = null;
      observedGeometryRoots.clear();
      for (const entry of entries.values()) clearElements(entry);
      entries.clear();
      layer?.remove();
      if (nativeApi) {
        nativeApi.registry.delete(passiveHighlightName);
        nativeApi.registry.delete(activeHighlightName);
      }
      nativeStyle?.remove();
    },
    size: () => entries.size,
  };
}
