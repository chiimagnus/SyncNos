type InpageSurfaceThemeOptions = {
  host: HTMLElement;
  document: Document;
  resolveSource?: () => Element | null;
};

type StyleSnapshot = {
  value: string;
  priority: string;
};

const MANAGED_PROPERTIES = [
  '--bg-primary',
  '--bg-sunken',
  '--bg-card',
  '--text-primary',
  '--text-secondary',
  '--border',
  'color-scheme',
  'filter',
] as const;

const COLOR_FILTER_RE = /(?:brightness|contrast|grayscale|hue-rotate|invert|opacity|saturate|sepia)\([^)]*\)/gi;

function snapshotStyle(host: HTMLElement): Map<string, StyleSnapshot> {
  return new Map(
    MANAGED_PROPERTIES.map((name) => [
      name,
      {
        value: host.style.getPropertyValue(name),
        priority: host.style.getPropertyPriority(name),
      },
    ]),
  );
}

function restoreStyle(host: HTMLElement, snapshot: Map<string, StyleSnapshot>) {
  for (const name of MANAGED_PROPERTIES) {
    const previous = snapshot.get(name);
    if (!previous?.value) host.style.removeProperty(name);
    else host.style.setProperty(name, previous.value, previous.priority);
  }
}

function isTransparentColor(value: string): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized || normalized === 'transparent') return true;
  if (!normalized.startsWith('rgb')) return false;

  const parts = normalized.match(/[+-]?(?:\d+\.?\d*|\.\d+)%?/g) || [];
  if (parts.length < 4) return false;
  const alpha = parts[3]!;
  if (alpha.endsWith('%')) return Number.parseFloat(alpha) <= 0;
  return Number.parseFloat(alpha) <= 0;
}

function readSource(options: InpageSurfaceThemeOptions): Element | null {
  try {
    const source = options.resolveSource?.();
    if (source?.ownerDocument === options.document && !options.host.contains(source)) return source;
  } catch (_error) {
    // Fall through to document surfaces.
  }

  const doc = options.document;
  const win = doc.defaultView;
  try {
    const hit = doc.elementFromPoint?.(Math.round((win?.innerWidth || 0) / 2), Math.round((win?.innerHeight || 0) / 2));
    const article = hit?.closest?.('article, main, [role="main"]') || null;
    if (article && article !== options.host && !options.host.contains(article)) return article;
  } catch (_error) {
    // Fall through to the document body.
  }

  return doc.body || doc.documentElement;
}

function readSurfaceBackground(win: Window, source: Element, doc: Document): string {
  let current: Element | null = source;
  while (current) {
    const color = String(win.getComputedStyle(current).backgroundColor || '').trim();
    if (!isTransparentColor(color)) return color;
    if (current === doc.documentElement) break;
    current = current.parentElement;
  }

  const colorScheme = String(win.getComputedStyle(doc.documentElement).colorScheme || '').toLowerCase();
  return colorScheme.includes('dark') ? 'rgb(18 18 18)' : 'rgb(255 255 255)';
}

function readTextColor(win: Window, source: Element, doc: Document): string {
  const sourceColor = String(win.getComputedStyle(source).color || '').trim();
  if (sourceColor) return sourceColor;
  const bodyColor = doc.body ? String(win.getComputedStyle(doc.body).color || '').trim() : '';
  return bodyColor || 'rgb(17 17 17)';
}

function readColorScheme(win: Window, source: Element, doc: Document, background: string): 'light' | 'dark' {
  let current: Element | null = source;
  while (current) {
    const scheme = String(win.getComputedStyle(current).colorScheme || '').toLowerCase();
    if (scheme === 'dark') return 'dark';
    if (scheme === 'light') return 'light';
    if (current === source && scheme.includes('dark') && !scheme.includes('light')) return 'dark';
    if (current === doc.documentElement) break;
    current = current.parentElement;
  }

  const channels = background.match(/[+-]?(?:\d+\.?\d*|\.\d+)/g);
  if (channels && channels.length >= 3) {
    const [r, g, b] = channels.slice(0, 3).map((value) => Number.parseFloat(value) / 255);
    const linear = [r, g, b].map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
    return luminance < 0.42 ? 'dark' : 'light';
  }

  return 'light';
}

function readMissingColorFilter(win: Window, source: Element, doc: Document): string {
  const filters: string[] = [];
  let current: Element | null = source;

  // The panel is a direct child of <html>, so <html>'s filter is already shared.
  while (current && current !== doc.documentElement) {
    const filter = String(win.getComputedStyle(current).filter || '').trim();
    if (filter && filter !== 'none') {
      const matches = filter.match(COLOR_FILTER_RE);
      if (matches?.length) filters.push(...matches);
    }
    current = current.parentElement;
  }

  return filters.join(' ');
}

function applyTheme(
  host: HTMLElement,
  win: Window,
  source: Element,
  doc: Document,
  original: Map<string, StyleSnapshot>,
) {
  const background = readSurfaceBackground(win, source, doc);
  const text = readTextColor(win, source, doc);
  const scheme = readColorScheme(win, source, doc, background);

  host.style.setProperty('--bg-primary', background, 'important');
  host.style.setProperty('--bg-card', background, 'important');
  host.style.setProperty('--bg-sunken', `color-mix(in srgb, ${background} 96%, ${text})`, 'important');
  host.style.setProperty('--text-primary', text, 'important');
  host.style.setProperty('--text-secondary', `color-mix(in srgb, ${text} 64%, ${background})`, 'important');
  host.style.setProperty('--border', `color-mix(in srgb, ${text} 18%, ${background})`, 'important');
  host.style.setProperty('color-scheme', scheme, 'important');

  const originalFilter = original.get('filter');
  if (!originalFilter?.value) host.style.removeProperty('filter');
  else host.style.setProperty('filter', originalFilter.value, originalFilter.priority);

  const directHostFilter = String(win.getComputedStyle(host).filter || '').trim();
  const missingFilter = readMissingColorFilter(win, source, doc);
  if (!missingFilter) return;

  const directColorFilters =
    directHostFilter && directHostFilter !== 'none' ? directHostFilter.match(COLOR_FILTER_RE) : null;
  if (directColorFilters?.length) return;

  host.style.setProperty(
    'filter',
    directHostFilter && directHostFilter !== 'none' ? `${directHostFilter} ${missingFilter}` : missingFilter,
  );
}

export function installInpageSurfaceTheme(options: InpageSurfaceThemeOptions): () => void {
  const { host, document: doc } = options;
  const win = doc.defaultView;
  if (!win) return () => {};

  const original = snapshotStyle(host);
  let disposed = false;
  let rafId: number | null = null;
  let mutationObserver: MutationObserver | null = null;
  let mediaQuery: MediaQueryList | null = null;
  let observedSource: Element | null = null;

  const schedule = () => {
    if (disposed || rafId != null) return;
    rafId = win.requestAnimationFrame(() => {
      rafId = null;
      sync();
    });
  };

  const observe = (source: Element) => {
    if (!mutationObserver || source === observedSource) return;
    mutationObserver.disconnect();
    observedSource = source;

    let current: Element | null = source;
    while (current) {
      mutationObserver.observe(current, {
        attributes: true,
        childList: current === doc.documentElement,
      });
      if (current === doc.documentElement) break;
      current = current.parentElement;
    }

    if (doc.head) {
      mutationObserver.observe(doc.head, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }
  };

  const sync = () => {
    if (disposed) return;
    const source = readSource(options);
    if (!source) return;
    applyTheme(host, win, source, doc, original);
    observe(source);
  };

  const MutationObserverCtor = win.MutationObserver;
  if (MutationObserverCtor) mutationObserver = new MutationObserverCtor(schedule);

  doc.addEventListener('selectionchange', schedule, true);

  try {
    mediaQuery = win.matchMedia?.('(prefers-color-scheme: dark)') || null;
    mediaQuery?.addEventListener?.('change', schedule);
  } catch (_error) {
    mediaQuery = null;
  }

  sync();

  return () => {
    if (disposed) return;
    disposed = true;
    if (rafId != null) win.cancelAnimationFrame(rafId);
    rafId = null;
    mutationObserver?.disconnect();
    mutationObserver = null;
    doc.removeEventListener('selectionchange', schedule, true);
    try {
      mediaQuery?.removeEventListener?.('change', schedule);
    } catch (_error) {
      // ignore
    }
    restoreStyle(host, original);
  };
}
