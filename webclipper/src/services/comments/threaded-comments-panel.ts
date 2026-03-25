import { t } from '@i18n';
import { createTwoStepConfirmController } from '@services/shared/two-step-confirm';
import inpageCommentsPanelCssRaw from '@ui/styles/inpage-comments-panel.css?raw';
import buttonsCssRaw from '@ui/styles/buttons.css?raw';
import tokensCssRaw from '@ui/styles/tokens.css?raw';
import { restoreRangeFromArticleCommentLocator } from '@services/comments/locator';

export type ThreadedCommentItem = {
  id: number;
  parentId: number | null;
  authorName?: string | null;
  createdAt?: number | null;
  quoteText?: string | null;
  commentText: string;
  locator?: any | null;
};

export type ThreadedCommentsPanelApi = {
  open: (input?: { focusComposer?: boolean }) => void;
  close: () => void;
  isOpen: () => boolean;
  setBusy: (busy: boolean) => void;
  setQuoteText: (text: string) => void;
  setComments: (items: ThreadedCommentItem[]) => void;
  setHandlers: (handlers: {
    onSave?: (text: string) => void | boolean | Promise<void | boolean>;
    onReply?: (parentId: number, text: string) => void | Promise<void>;
    onDelete?: (id: number) => void | Promise<void>;
    onClose?: () => void;
  }) => void;
};

function toHostTokensCss(css: string) {
  // Scope tokens to the Shadow DOM host so inpage panels still use our design system.
  // `tokens.css` uses `:root` selectors; in Shadow DOM we want `:host`.
  return css.replaceAll(':root', ':host');
}

const COMMENTS_SIDEBAR_WIDTH_STORAGE_KEY = 'webclipper_comments_sidebar_width_v1';
const COMMENTS_SIDEBAR_WIDTH_MIN_PX = 320;
const COMMENTS_SIDEBAR_WIDTH_MAX_PX = 720;
const COMMENTS_SIDEBAR_MIN_MAIN_WIDTH_PX = 360;

const PANEL_SHADOW_CSS = [
  toHostTokensCss(String(tokensCssRaw || '')),
  String(buttonsCssRaw || ''),
  String(inpageCommentsPanelCssRaw || ''),
]
  .filter(Boolean)
  .join('\n');

function setImportantStyle(el: HTMLElement, name: string, value: string) {
  el.style.setProperty(name, value, 'important');
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function autosizeTextarea(textarea: HTMLTextAreaElement | null | undefined) {
  const el = textarea as any;
  if (!el) return;
  try {
    el.style.overflowY = 'hidden';
    el.style.height = '0px';
    const next = Math.max(0, Number(el.scrollHeight || 0) || 0);
    el.style.height = `${next}px`;
  } catch (_e) {
    // ignore
  }
}

function isEditableTarget(target: unknown): boolean {
  const el = target as any;
  const tag = String(el?.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return true;
  try {
    if (el?.isContentEditable) return true;
  } catch (_e) {
    // ignore
  }
  return false;
}

function formatTime(ts: number | null | undefined): string {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return '';
  try {
    return new Date(t).toLocaleString();
  } catch (_e) {
    return '';
  }
}

function compareCommentTimeDesc(a: ThreadedCommentItem, b: ThreadedCommentItem): number {
  const ta = Number((a as any)?.createdAt) || 0;
  const tb = Number((b as any)?.createdAt) || 0;
  if (tb !== ta) return tb - ta;
  const ia = Number((a as any)?.id) || 0;
  const ib = Number((b as any)?.id) || 0;
  return ib - ia;
}

type MountOptions = {
  overlay?: boolean;
  initiallyOpen?: boolean;
  showHeader?: boolean;
  showCollapseButton?: boolean;
  variant?: 'embedded' | 'sidebar';
  // Optional surface background for sidebar variant. When provided, it will be
  // exposed to CSS via `--webclipper-comments-panel-surface-bg`.
  surfaceBg?: string;
  // Optional visual divider between header and body. By default:
  // - `sidebar`: no divider (cleaner, matches app shell columns)
  // - `embedded`: divider
  headerDivider?: boolean;
  // When `true`, opening the overlay panel will "dock" the host page content by
  // applying right padding to `document.documentElement` so the page is not
  // covered by the sidebar. Intended for inpage content-scripts only.
  dockPage?: boolean;
  locatorEnv?: 'inpage' | 'app' | null;
  getLocatorRoot?: () => Element | null;
};

function pickLocatorRoot(options: MountOptions): Element | null {
  const getter = options.getLocatorRoot;
  if (typeof getter === 'function') {
    try {
      return getter() || null;
    } catch (_e) {
      return null;
    }
  }
  return null;
}

function shouldIgnoreLocateClick(target: EventTarget | null): boolean {
  const el = target as any as HTMLElement | null;
  if (!el) return false;
  if (isEditableTarget(el)) return true;
  try {
    if (el.closest?.('button,input,textarea,a,label,select,option')) return true;
  } catch (_e) {
    // ignore
  }
  return false;
}

function pickRangeTargetElement(range: Range): HTMLElement | null {
  const node = (range as any).startContainer as Node | null;
  return node && (node as any).nodeType === Node.TEXT_NODE
    ? ((node as any).parentElement as HTMLElement | null)
    : (node as any as HTMLElement | null);
}

const LOCATE_HIGHLIGHT_ATTR = 'data-webclipper-locate-highlight';
const LOCATE_HIGHLIGHT_STYLE_ID = 'webclipper-comments-locate-highlight-style';

function ensureLocateHighlightStyle() {
  try {
    if (document.getElementById(LOCATE_HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = LOCATE_HIGHLIGHT_STYLE_ID;
    style.textContent = [
      `[${LOCATE_HIGHLIGHT_ATTR}="1"] {`,
      '  outline: 2px solid rgba(79, 156, 255, 0.95) !important;',
      '  outline-offset: 2px !important;',
      '  border-radius: 8px !important;',
      '  background-color: rgba(79, 156, 255, 0.12) !important;',
      '  transition: background-color 200ms ease, outline-color 200ms ease !important;',
      '}',
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  } catch (_e) {
    // ignore
  }
}

function createLocateHighlighter() {
  let lastEl: HTMLElement | null = null;
  let timer: any = 0;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = 0;
    if (lastEl) {
      try {
        lastEl.removeAttribute(LOCATE_HIGHLIGHT_ATTR);
      } catch (_e) {
        // ignore
      }
    }
    lastEl = null;
  };

  const flash = (el: HTMLElement) => {
    if (!el) return;
    ensureLocateHighlightStyle();

    if (lastEl && lastEl !== el) {
      try {
        lastEl.removeAttribute(LOCATE_HIGHLIGHT_ATTR);
      } catch (_e) {
        // ignore
      }
    }
    lastEl = el;

    try {
      el.setAttribute(LOCATE_HIGHLIGHT_ATTR, '1');
    } catch (_e) {
      // ignore
    }

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        el.removeAttribute(LOCATE_HIGHLIGHT_ATTR);
      } catch (_e) {
        // ignore
      }
      if (lastEl === el) lastEl = null;
      timer = 0;
    }, 1400);
  };

  return { flash, clear };
}

function scrollRangeIntoView(range: Range, highlighter?: { flash: (el: HTMLElement) => void }): boolean {
  const el = pickRangeTargetElement(range);
  if (!el) return false;
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' } as any);
    try {
      highlighter?.flash(el);
    } catch (_e2) {
      // ignore
    }
    return true;
  } catch (_e) {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function readLocatorHint(locator: unknown): number | null {
  const hint = Number((locator as any)?.position?.start);
  return Number.isFinite(hint) ? hint : null;
}

function isScrollableContainer(el: unknown): el is HTMLElement {
  const node = el as any as HTMLElement | null;
  if (!node) return false;
  if (typeof node.scrollTop !== 'number') return false;
  const scrollHeight = Number((node as any).scrollHeight || 0);
  const clientHeight = Number((node as any).clientHeight || 0);
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return false;
  return scrollHeight - clientHeight >= 240 && clientHeight >= 120;
}

function pickBestScrollContainer(rootEl: Element): HTMLElement | null {
  const candidates: HTMLElement[] = [];
  const scrollingEl = (document as any).scrollingElement as any;
  if (isScrollableContainer(scrollingEl)) candidates.push(scrollingEl);
  if (isScrollableContainer(document.documentElement)) candidates.push(document.documentElement);
  if (isScrollableContainer(document.body)) candidates.push(document.body);
  if (isScrollableContainer(rootEl)) candidates.push(rootEl);

  try {
    const common = document.querySelectorAll?.('main,[role="main"],article');
    if (common && typeof (common as any).length === 'number') {
      for (const node of Array.from(common as any)) {
        if (isScrollableContainer(node)) candidates.push(node);
      }
    }
  } catch (_e) {
    // ignore
  }

  // Limited scan: some apps (e.g. docs/community) use a single large div scroller.
  try {
    const walkRoot = document.body || document.documentElement;
    if (walkRoot) {
      const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_ELEMENT);
      let best: { el: HTMLElement; score: number } | null = null;
      let count = 0;
      while (walker.nextNode() && count < 600) {
        count += 1;
        const el = walker.currentNode as any as HTMLElement;
        if (!isScrollableContainer(el)) continue;
        const scrollHeight = Number((el as any).scrollHeight || 0);
        const clientHeight = Number((el as any).clientHeight || 0);
        const score = (scrollHeight - clientHeight) * 2 + clientHeight;
        if (!best || score > best.score) best = { el, score };
      }
      if (best) candidates.push(best.el);
    }
  } catch (_e) {
    // ignore
  }

  if (!candidates.length) return null;
  const seen = new Set<HTMLElement>();
  for (const el of candidates) {
    if (!el || seen.has(el)) continue;
    seen.add(el);
    return el;
  }
  return null;
}

function nudgeScrollTowardsHint(hint: number, rootEl: Element): void {
  const scroller = pickBestScrollContainer(rootEl);
  if (!scroller) return;

  const maxScroll = Math.max(
    0,
    Number((scroller as any).scrollHeight || 0) - Number((scroller as any).clientHeight || 0),
  );
  if (!Number.isFinite(maxScroll) || maxScroll <= 0) return;

  const textLength = Math.max(0, Number(String((rootEl as any)?.textContent || '').length) || 0);
  const ratio = textLength > 0 ? Math.max(0, Math.min(1, hint / textLength)) : 1;
  const nextTop = Math.round(maxScroll * ratio);

  try {
    (scroller as any).scrollTop = nextTop;
  } catch (_e) {
    // ignore
  }
}

export function mountThreadedCommentsPanel(
  host: HTMLElement,
  options: MountOptions = {},
): { el: HTMLElement; api: ThreadedCommentsPanelApi; cleanup: () => void } {
  const el = document.createElement('webclipper-threaded-comments-panel') as any as HTMLElement;
  const isOverlay = options.overlay === true;
  if (isOverlay) el.setAttribute('data-overlay', '1');
  const variant = options.variant === 'sidebar' ? 'sidebar' : 'embedded';
  if (variant === 'sidebar') el.setAttribute('data-variant', 'sidebar');
  if (options.initiallyOpen) el.setAttribute('data-open', '1');
  const showHeader = options.showHeader !== false;
  const showCollapseButton = options.showCollapseButton ?? options.overlay === true;
  const dockPage = options.dockPage === true && options.overlay === true;
  const surfaceBg = String(options.surfaceBg || '').trim();

  const SURFACE_BG_CSS_VAR = '--webclipper-comments-panel-surface-bg';
  if (surfaceBg) {
    setImportantStyle(el, SURFACE_BG_CSS_VAR, surfaceBg);
  }

  const HEADER_DIVIDER_CSS_VAR = '--webclipper-comments-panel-header-divider';
  const headerDivider = options.headerDivider ?? variant !== 'sidebar';
  setImportantStyle(el, HEADER_DIVIDER_CSS_VAR, headerDivider && showHeader ? '1px solid var(--panel-border)' : '0');

  const DOCK_STYLE_ID = 'webclipper-inpage-comments-panel__dock-style';

  function ensureDockStyle() {
    if (!dockPage) return;
    try {
      if (document.getElementById(DOCK_STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = DOCK_STYLE_ID;
      style.textContent = [
        "html[data-webclipper-comments-dock='1'] {",
        '  box-sizing: border-box !important;',
        '  padding-right: var(--webclipper-comments-dock-width, 0px) !important;',
        '  overflow-x: hidden !important;',
        '}',
        "html[data-webclipper-comments-dock='1'] body {",
        '  box-sizing: border-box !important;',
        '}',
      ].join('\n');
      (document.head || document.documentElement).appendChild(style);
    } catch (_e) {
      // ignore
    }
  }

  function readDockWidthPx(): number {
    try {
      const rect = el.getBoundingClientRect?.();
      const w = Number(rect?.width || 0);
      if (Number.isFinite(w) && w > 0) return w;
    } catch (_e) {
      // ignore
    }
    try {
      const computed = getComputedStyle(el);
      const w = Number.parseFloat(
        String((computed as any)?.width || '')
          .replace('px', '')
          .trim(),
      );
      if (Number.isFinite(w) && w > 0) return w;
    } catch (_e) {
      // ignore
    }
    return 420;
  }

  let dockRaf: number | null = null;
  const dockResize = () => {
    try {
      if (!dockPage) return;
      if (el.getAttribute('data-open') !== '1') return;
      const width = Math.round(readDockWidthPx());
      document.documentElement.style.setProperty('--webclipper-comments-dock-width', `${width}px`, 'important');
    } catch (_e) {
      // ignore
    }
  };

  const widthState = {
    widthPx: null as number | null,
    dragging: false,
    pointerId: null as number | null,
  };

  const SIDEBAR_WIDTH_CSS_VAR = '--webclipper-comments-panel-width';

  function readPersistedSidebarWidthPx(): number | null {
    try {
      const raw = localStorage.getItem(COMMENTS_SIDEBAR_WIDTH_STORAGE_KEY);
      const parsed = Number.parseFloat(String(raw || '').trim());
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return Math.round(parsed);
    } catch (_e) {
      return null;
    }
  }

  function persistSidebarWidthPx(widthPx: number) {
    try {
      localStorage.setItem(COMMENTS_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(widthPx)));
    } catch (_e) {
      // ignore
    }
  }

  function clampSidebarWidthPx(widthPx: number): number {
    const viewport = Math.max(
      1,
      Math.round(Number(globalThis.innerWidth || document.documentElement?.clientWidth || 0) || 0),
    );
    const maxCap = Math.max(
      COMMENTS_SIDEBAR_WIDTH_MIN_PX,
      isOverlay ? Math.floor(viewport * 0.92) : viewport - COMMENTS_SIDEBAR_MIN_MAIN_WIDTH_PX,
    );
    const max = Math.max(COMMENTS_SIDEBAR_WIDTH_MIN_PX, Math.min(COMMENTS_SIDEBAR_WIDTH_MAX_PX, maxCap));
    return Math.round(clamp(widthPx, COMMENTS_SIDEBAR_WIDTH_MIN_PX, max));
  }

  function setSidebarWidthPx(widthPx: number | null, input?: { persist?: boolean }) {
    if (variant !== 'sidebar') return;
    if (widthPx == null) {
      widthState.widthPx = null;
      try {
        el.style.removeProperty(SIDEBAR_WIDTH_CSS_VAR);
      } catch (_e) {
        // ignore
      }
      dockResize();
      return;
    }

    const clamped = clampSidebarWidthPx(widthPx);
    widthState.widthPx = clamped;
    try {
      el.style.setProperty(SIDEBAR_WIDTH_CSS_VAR, `${clamped}px`, 'important');
    } catch (_e) {
      // ignore
    }
    if (input?.persist !== false) persistSidebarWidthPx(clamped);
    dockResize();
  }

  if (variant === 'sidebar') {
    const persistedWidth = readPersistedSidebarWidthPx();
    if (persistedWidth != null) {
      widthState.widthPx = clampSidebarWidthPx(persistedWidth);
      setSidebarWidthPx(widthState.widthPx, { persist: false });
    }
  }

  function setDockOpen(open: boolean) {
    if (!dockPage) return;
    const root = document.documentElement;
    if (!root) return;

    if (open) {
      ensureDockStyle();
      try {
        root.setAttribute('data-webclipper-comments-dock', '1');
      } catch (_e) {
        // ignore
      }

      // Set it once synchronously, then again on next frame so layout has settled.
      dockResize();
      try {
        if (dockRaf != null) cancelAnimationFrame(dockRaf);
        dockRaf = requestAnimationFrame(() => {
          dockRaf = null;
          dockResize();
        });
      } catch (_e) {
        // ignore
      }
      try {
        globalThis.addEventListener?.('resize', dockResize, { passive: true } as any);
      } catch (_e) {
        // ignore
      }
      return;
    }

    try {
      if (dockRaf != null) cancelAnimationFrame(dockRaf);
    } catch (_e) {
      // ignore
    }
    dockRaf = null;
    try {
      globalThis.removeEventListener?.('resize', dockResize as any);
    } catch (_e) {
      // ignore
    }
    try {
      root.removeAttribute('data-webclipper-comments-dock');
    } catch (_e) {
      // ignore
    }
    try {
      root.style.removeProperty('--webclipper-comments-dock-width');
    } catch (_e) {
      // ignore
    }
  }

  const shadow = el.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_SHADOW_CSS;
  shadow.appendChild(style);

  const surface = document.createElement('div');
  surface.className = 'webclipper-inpage-comments-panel__surface';
  shadow.appendChild(surface);

  let cleanupSidebarResize: (() => void) | null = null;
  if (variant === 'sidebar') {
    const handle = document.createElement('div');
    handle.className = 'webclipper-inpage-comments-panel__resize-handle';
    surface.appendChild(handle);

    const stopEvent = (event: Event) => {
      try {
        (event as any).preventDefault?.();
      } catch (_e) {
        // ignore
      }
      try {
        (event as any).stopPropagation?.();
      } catch (_e) {
        // ignore
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!widthState.dragging) return;
      if (widthState.pointerId != null && e.pointerId !== widthState.pointerId) return;
      stopEvent(e);
      const viewport = Math.max(
        1,
        Math.round(Number(globalThis.innerWidth || document.documentElement?.clientWidth || 0) || 0),
      );
      const nextWidth = viewport - e.clientX;
      setSidebarWidthPx(nextWidth, { persist: false });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!widthState.dragging) return;
      if (widthState.pointerId != null && e.pointerId !== widthState.pointerId) return;
      stopEvent(e);
      widthState.dragging = false;
      widthState.pointerId = null;
      try {
        el.removeAttribute('data-resizing');
      } catch (_e) {
        // ignore
      }
      try {
        (handle as any).releasePointerCapture?.(e.pointerId);
      } catch (_e) {
        // ignore
      }
      if (widthState.widthPx != null) persistSidebarWidthPx(widthState.widthPx);
      try {
        globalThis.removeEventListener?.('pointermove', onPointerMove as any, true);
        globalThis.removeEventListener?.('pointerup', onPointerUp as any, true);
        globalThis.removeEventListener?.('pointercancel', onPointerUp as any, true);
      } catch (_e) {
        // ignore
      }
      dockResize();
    };

    const onPointerDown = (e: PointerEvent) => {
      if ((e as any).button != null && (e as any).button !== 0) return;
      stopEvent(e);
      widthState.dragging = true;
      widthState.pointerId = e.pointerId;
      try {
        el.setAttribute('data-resizing', '1');
      } catch (_e) {
        // ignore
      }
      if (widthState.widthPx == null) {
        const measured = readDockWidthPx();
        setSidebarWidthPx(measured, { persist: false });
      }
      try {
        (handle as any).setPointerCapture?.(e.pointerId);
      } catch (_e) {
        // ignore
      }
      try {
        globalThis.addEventListener?.('pointermove', onPointerMove as any, true);
        globalThis.addEventListener?.('pointerup', onPointerUp as any, true);
        globalThis.addEventListener?.('pointercancel', onPointerUp as any, true);
      } catch (_e) {
        // ignore
      }
    };

    handle.addEventListener('pointerdown', onPointerDown);

    const onViewportResize = () => {
      if (widthState.widthPx == null) return;
      const clamped = clampSidebarWidthPx(widthState.widthPx);
      if (clamped === widthState.widthPx) return;
      setSidebarWidthPx(clamped, { persist: true });
    };

    try {
      globalThis.addEventListener?.('resize', onViewportResize as any, { passive: true } as any);
    } catch (_e) {
      // ignore
    }

    cleanupSidebarResize = () => {
      try {
        handle.removeEventListener('pointerdown', onPointerDown);
      } catch (_e) {
        // ignore
      }
      try {
        globalThis.removeEventListener?.('pointermove', onPointerMove as any, true);
        globalThis.removeEventListener?.('pointerup', onPointerUp as any, true);
        globalThis.removeEventListener?.('pointercancel', onPointerUp as any, true);
      } catch (_e) {
        // ignore
      }
      try {
        globalThis.removeEventListener?.('resize', onViewportResize as any);
      } catch (_e) {
        // ignore
      }
    };
  }

  if (showHeader) {
    const header = document.createElement('div');
    header.className = 'webclipper-inpage-comments-panel__header';
    surface.appendChild(header);

    const headerTitle = document.createElement('div');
    headerTitle.className = 'webclipper-inpage-comments-panel__header-title';
    headerTitle.textContent = t('articleCommentsHeading');
    header.appendChild(headerTitle);

    if (showCollapseButton) {
      const collapse = document.createElement('button');
      collapse.type = 'button';
      collapse.className =
        'webclipper-inpage-comments-panel__collapse webclipper-btn webclipper-btn--icon webclipper-btn--icon-sm webclipper-btn--tone-muted';
      const collapseLabel = t('closeCommentsSidebar');
      collapse.setAttribute('aria-label', collapseLabel);
      collapse.setAttribute('title', collapseLabel);
      collapse.innerHTML = [
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
        '<path d="M6.25 3.25L9.5 6.5L6.25 9.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />',
        '<path d="M9.3 6.5H3.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />',
        '</svg>',
      ].join('');
      collapse.addEventListener('click', () => apiRef.close());
      header.appendChild(collapse);
    }
  }

  const body = document.createElement('div');
  body.className = 'webclipper-inpage-comments-panel__body';
  surface.appendChild(body);

  const locateHighlighter = createLocateHighlighter();

  const notice = document.createElement('div');
  notice.className = 'webclipper-inpage-comments-panel__notice';
  notice.style.display = 'none';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.setAttribute('aria-atomic', 'true');
  body.appendChild(notice);

  const quote = document.createElement('div');
  quote.className = 'webclipper-inpage-comments-panel__quote';
  body.appendChild(quote);

  const quoteText = document.createElement('div');
  quoteText.className = 'webclipper-inpage-comments-panel__quote-text';
  quoteText.textContent = '';
  quote.appendChild(quoteText);

  const composer = document.createElement('div');
  composer.className = 'webclipper-inpage-comments-panel__composer';
  body.appendChild(composer);

  const composerAvatar = document.createElement('div');
  composerAvatar.className = 'webclipper-inpage-comments-panel__avatar';
  composerAvatar.textContent = 'You';
  composer.appendChild(composerAvatar);

  const composerMain = document.createElement('div');
  composerMain.className = 'webclipper-inpage-comments-panel__composer-main';
  composer.appendChild(composerMain);

  const composerTextarea = document.createElement('textarea');
  composerTextarea.className = 'webclipper-inpage-comments-panel__composer-textarea';
  composerTextarea.placeholder = 'Write a comment…';
  composerTextarea.rows = 1;
  composerMain.appendChild(composerTextarea);

  const composerActions = document.createElement('div');
  composerActions.className = 'webclipper-inpage-comments-panel__composer-actions';
  composerMain.appendChild(composerActions);

  const composerSend = document.createElement('button');
  composerSend.className =
    'webclipper-inpage-comments-panel__send webclipper-btn webclipper-btn--filled webclipper-btn--icon';
  composerSend.type = 'button';
  composerSend.setAttribute('aria-label', 'Comment');
  composerSend.textContent = '↑';
  composerActions.appendChild(composerSend);

  const threads = document.createElement('div');
  threads.className = 'webclipper-inpage-comments-panel__threads';
  body.appendChild(threads);

  const empty = document.createElement('div');
  empty.className = 'webclipper-inpage-comments-panel__empty';
  empty.textContent = 'No comments yet';

  const state = {
    busy: false,
    pendingComposerFocus: false,
    noticeTimer: 0 as any,
    handlers: {
      onSave: null as any,
      onReply: null as any,
      onDelete: null as any,
      onClose: null as any,
    },
  };

  function showNotice(message: string) {
    const text = String(message || '').trim();
    if (!text) return;
    try {
      notice.textContent = text;
      notice.style.display = 'block';
      if (state.noticeTimer) clearTimeout(state.noticeTimer);
      state.noticeTimer = setTimeout(() => {
        notice.style.display = 'none';
        notice.textContent = '';
      }, 1600);
    } catch (_e) {
      // ignore
    }
  }

  function locateThreadRootOnce(rootItem: ThreadedCommentItem, rootEl: Element): boolean {
    const locator = (rootItem as any)?.locator;
    if (!locator) return false;

    const env = String((locator as any)?.env || '').trim();
    const expectedEnv = String(options.locatorEnv || '').trim();
    if (!expectedEnv || env !== expectedEnv) return false;

    try {
      const range = restoreRangeFromArticleCommentLocator({ root: rootEl, locator });
      if (!range) return false;
      return scrollRangeIntoView(range, locateHighlighter);
    } catch (_e) {
      return false;
    }
  }

  async function locateThreadRootWithRetry(rootItem: ThreadedCommentItem): Promise<boolean> {
    const locator = (rootItem as any)?.locator;
    if (!locator) return false;

    const env = String((locator as any)?.env || '').trim();
    const expectedEnv = String(options.locatorEnv || '').trim();
    if (!expectedEnv || env !== expectedEnv) return false;

    const pickedRoot = pickLocatorRoot(options);
    if (expectedEnv === 'app' && !pickedRoot) return false;
    const rootEl = pickedRoot || document.body || document.documentElement;
    if (!rootEl) return false;

    const ok = locateThreadRootOnce(rootItem, rootEl);
    if (ok) return true;

    // P2-T1: inpage retry to handle dynamic loading (lazy/infinite scroll).
    if (expectedEnv !== 'inpage') return false;
    const hint = readLocatorHint(locator);
    if (hint != null) nudgeScrollTowardsHint(hint, rootEl);

    await sleep(120);
    const ok2 = locateThreadRootOnce(rootItem, rootEl);
    if (ok2) return true;

    await sleep(260);
    return locateThreadRootOnce(rootItem, rootEl);
  }

  const deleteConfirm = createTwoStepConfirmController<number>({
    onChange: () => {
      refreshDeleteButtons();
    },
  });

  function getDeleteButtons() {
    try {
      return Array.from(
        shadow.querySelectorAll?.('button[data-webclipper-comment-delete-id]') || [],
      ) as HTMLButtonElement[];
    } catch (_e) {
      return [] as HTMLButtonElement[];
    }
  }

  function applyDeleteButtonUi(button: HTMLButtonElement, confirming: boolean) {
    if (!button) return;

    if (confirming) {
      button.setAttribute('data-confirm', '1');
      button.classList.remove('webclipper-btn--danger-tint');
      button.classList.remove('webclipper-btn--icon');
      button.classList.add('webclipper-btn--danger');
      button.textContent = t('deleteButton');
      button.setAttribute('aria-label', t('deleteButton'));
      button.title = '';
    } else {
      button.removeAttribute('data-confirm');
      button.classList.remove('webclipper-btn--danger');
      button.classList.add('webclipper-btn--danger-tint');
      button.classList.add('webclipper-btn--icon');
      button.textContent = '×';
      button.setAttribute('aria-label', t('deleteButton'));
      button.title = '';
    }
  }

  function refreshDeleteButtons() {
    const buttons = getDeleteButtons();

    const pendingId = deleteConfirm.getArmedKey();
    if (pendingId == null) {
      for (const btn of buttons) applyDeleteButtonUi(btn, false);
      return;
    }

    let hasPending = false;
    for (const btn of buttons) {
      const id = Number(btn.getAttribute('data-webclipper-comment-delete-id') || 0);
      const confirming = Number.isFinite(id) && id > 0 && id === pendingId;
      if (confirming) hasPending = true;
      applyDeleteButtonUi(btn, confirming);
    }

    if (!hasPending) {
      deleteConfirm.clear();
    }
  }

  const focusComposer = () => {
    try {
      if (!composerTextarea || typeof (composerTextarea as any).focus !== 'function') return;
      (composerTextarea as any).focus();
      // Put caret at the end for convenience.
      try {
        const value = String((composerTextarea as any).value || '');
        (composerTextarea as any).setSelectionRange?.(value.length, value.length);
      } catch (_e2) {
        // ignore
      }
    } catch (_e) {
      // ignore
    }
  };

  function refreshButtons() {
    const text = String((composerTextarea as any).value || '').trim();
    composerSend.disabled = state.busy || !text;
    // Keep composer editable even when busy (loading comments etc). We'll block send instead.
    composerTextarea.disabled = false;

    const replyInputs = shadow.querySelectorAll?.(
      '.webclipper-inpage-comments-panel__reply-textarea',
    ) as NodeListOf<HTMLTextAreaElement> | null;
    replyInputs?.forEach?.((node) => {
      try {
        node.disabled = false;
      } catch (_e) {
        // ignore
      }
    });

    const sendButtons = shadow.querySelectorAll?.(
      '.webclipper-inpage-comments-panel__send',
    ) as NodeListOf<HTMLButtonElement> | null;
    sendButtons?.forEach?.((node) => {
      try {
        if (node === composerSend) return;
        const threadText = String((node as any).__webclipperTextValue?.() || '').trim();
        node.disabled = state.busy || !threadText;
      } catch (_e) {
        // ignore
      }
    });

    if (!state.busy && state.pendingComposerFocus) {
      state.pendingComposerFocus = false;
      focusComposer();
    }

    refreshDeleteButtons();
  }

  function setOpen(open: boolean) {
    if (open) {
      el.setAttribute('data-open', '1');
      setImportantStyle(el, 'display', 'block');
      setDockOpen(true);
    } else {
      el.removeAttribute('data-open');
      setImportantStyle(el, 'display', 'none');
      setDockOpen(false);
    }
  }

  autosizeTextarea(composerTextarea);
  composerTextarea.addEventListener('input', () => {
    autosizeTextarea(composerTextarea);
    refreshButtons();
  });
  const submitComposer = async () => {
    if (state.busy) return;
    const text = String((composerTextarea as any).value || '').trim();
    if (!text) return;
    const handler = state.handlers.onSave;
    if (typeof handler !== 'function') return;
    try {
      state.busy = true;
      refreshButtons();
      await handler(text);
      (composerTextarea as any).value = '';
      autosizeTextarea(composerTextarea);
    } finally {
      state.busy = false;
      refreshButtons();
    }
  };

  composerTextarea.addEventListener('keydown', (e) => {
    if ((e as any).isComposing) return;
    if (e.key !== 'Enter') return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.shiftKey || e.altKey) return;
    e.preventDefault();
    void submitComposer();
  });

  composerSend.addEventListener('click', () => {
    void submitComposer();
  });

  shadow.addEventListener('click', (e) => {
    if (deleteConfirm.getArmedKey() == null) return;
    const target = (e as any).target;
    try {
      const deleteButton = target?.closest?.('button[data-webclipper-comment-delete-id]');
      if (deleteButton) return;
    } catch (_e) {
      // ignore
    }
    deleteConfirm.clear();
  });

  shadow.addEventListener('keydown', (e) => {
    if (deleteConfirm.getArmedKey() == null) return;
    if ((e as any).isComposing) return;
    if ((e as any).key !== 'Escape') return;
    try {
      (e as any).preventDefault?.();
    } catch (_e) {
      // ignore
    }
    deleteConfirm.clear();
  });

  const apiRef: ThreadedCommentsPanelApi = {
    open(input) {
      const wasOpen = el.getAttribute('data-open') === '1';
      setOpen(true);
      try {
        if (!wasOpen) body.scrollTop = 0;
      } catch (_e) {
        // ignore
      }
      if (input?.focusComposer) {
        state.pendingComposerFocus = true;
        if (!state.busy) focusComposer();
      }
      apiRef.setBusy(false);
    },
    close() {
      setOpen(false);
      deleteConfirm.clear();
      const handler = state.handlers.onClose;
      if (typeof handler === 'function') handler();
    },
    isOpen() {
      return el.getAttribute('data-open') === '1' && (getComputedStyle(el).display || '') !== 'none';
    },
    setBusy(busy) {
      state.busy = !!busy;
      if (state.busy) {
        // If the composer currently has focus (or we just requested focus), keep a refocus request queued.
        try {
          if (document.activeElement === composerTextarea) state.pendingComposerFocus = true;
        } catch (_e) {
          // ignore
        }
      }
      refreshButtons();
    },
    setQuoteText(text) {
      const value = String(text || '');
      quoteText.textContent = value;
      quote.style.display = value ? 'block' : 'none';
    },
    setHandlers(handlers: any) {
      state.handlers = handlers || {
        onSave: null,
        onReply: null,
        onDelete: null,
        onClose: null,
      };
    },
    setComments(items) {
      threads.textContent = '';
      deleteConfirm.clear();
      const normalized = (Array.isArray(items) ? items : []).filter(
        (x) => x && Number.isFinite(Number((x as any)?.id)),
      );
      if (!normalized.length) {
        threads.appendChild(empty);
        refreshButtons();
        return;
      }

      const roots = normalized.filter((it) => !it.parentId).sort(compareCommentTimeDesc);
      const repliesByRoot = new Map<number, ThreadedCommentItem[]>();
      for (const it of normalized) {
        if (!it.parentId) continue;
        const rootId = Number(it.parentId);
        const list = repliesByRoot.get(rootId) || [];
        list.push(it);
        repliesByRoot.set(rootId, list);
      }

      for (const [rootId, list] of repliesByRoot) {
        repliesByRoot.set(rootId, list.sort(compareCommentTimeDesc));
      }

      for (const root of roots) {
        const rootId = Number(root.id);
        const thread = document.createElement('div');
        thread.className = 'webclipper-inpage-comments-panel__thread';
        threads.appendChild(thread);

        const quoteValue = String(root?.quoteText || '').trim();
        if (quoteValue) {
          const q = document.createElement('div');
          q.className = 'webclipper-inpage-comments-panel__thread-quote';
          thread.appendChild(q);

          const qText = document.createElement('div');
          qText.className = 'webclipper-inpage-comments-panel__thread-quote-text';
          qText.textContent = quoteValue;
          q.appendChild(qText);

          if (variant === 'sidebar') {
            q.addEventListener('click', (e) => {
              if (state.busy) return;
              if (shouldIgnoreLocateClick((e as any).target)) return;
              void (async () => {
                const ok = await locateThreadRootWithRetry(root);
                if (!ok) showNotice('无法定位');
              })();
            });
          }
        }

        const comment = document.createElement('div');
        comment.className = 'webclipper-inpage-comments-panel__comment';
        thread.appendChild(comment);

        const commentHeader = document.createElement('div');
        commentHeader.className = 'webclipper-inpage-comments-panel__comment-header';
        comment.appendChild(commentHeader);

        const commentAvatar = document.createElement('div');
        commentAvatar.className = 'webclipper-inpage-comments-panel__avatar';
        commentAvatar.textContent = 'You';
        commentHeader.appendChild(commentAvatar);

        const commentMeta = document.createElement('div');
        commentMeta.className = 'webclipper-inpage-comments-panel__comment-meta';
        commentHeader.appendChild(commentMeta);

        const author = document.createElement('div');
        author.className = 'webclipper-inpage-comments-panel__comment-author';
        author.textContent = String(root?.authorName || 'You');
        commentMeta.appendChild(author);

        const time = document.createElement('div');
        time.className = 'webclipper-inpage-comments-panel__comment-time';
        time.textContent = formatTime(root?.createdAt ?? null);
        commentMeta.appendChild(time);

        const commentActions = document.createElement('div');
        commentActions.className = 'webclipper-inpage-comments-panel__comment-actions';
        commentHeader.appendChild(commentActions);

        const del = document.createElement('button');
        del.className =
          'webclipper-inpage-comments-panel__icon-btn webclipper-btn webclipper-btn--danger-tint webclipper-btn--icon';
        del.type = 'button';
        del.setAttribute('data-webclipper-comment-delete-id', String(Number(root?.id) || ''));
        del.setAttribute('aria-label', t('deleteButton'));
        del.textContent = '×';
        del.addEventListener('click', async () => {
          if (state.busy) return;
          const id = Number(root?.id);
          if (!Number.isFinite(id) || id <= 0) return;
          if (!deleteConfirm.isArmed(id)) {
            deleteConfirm.arm(id);
            return;
          }
          deleteConfirm.clear();
          const handler = state.handlers.onDelete;
          if (typeof handler !== 'function') return;
          try {
            state.busy = true;
            refreshButtons();
            await handler(id);
          } finally {
            state.busy = false;
            refreshButtons();
          }
        });
        commentActions.appendChild(del);

        const commentBody = document.createElement('div');
        commentBody.className = 'webclipper-inpage-comments-panel__comment-body';
        commentBody.textContent = String(root?.commentText || '');
        comment.appendChild(commentBody);

        if (variant === 'sidebar') {
          comment.addEventListener('click', (e) => {
            if (state.busy) return;
            if (shouldIgnoreLocateClick((e as any).target)) return;
            void (async () => {
              const ok = await locateThreadRootWithRetry(root);
              if (!ok) showNotice('无法定位');
            })();
          });
        }

        const replies = repliesByRoot.get(rootId) || [];
        if (replies.length) {
          const repliesWrap = document.createElement('div');
          repliesWrap.className = 'webclipper-inpage-comments-panel__replies';
          thread.appendChild(repliesWrap);

          for (const reply of replies) {
            const replyRow = document.createElement('div');
            replyRow.className = 'webclipper-inpage-comments-panel__reply';
            repliesWrap.appendChild(replyRow);

            const replyHeader = document.createElement('div');
            replyHeader.className = 'webclipper-inpage-comments-panel__reply-header';
            replyRow.appendChild(replyHeader);

            const replyAvatar = document.createElement('div');
            replyAvatar.className = 'webclipper-inpage-comments-panel__avatar is-small';
            replyAvatar.textContent = 'You';
            replyHeader.appendChild(replyAvatar);

            const replyMeta = document.createElement('div');
            replyMeta.className = 'webclipper-inpage-comments-panel__reply-meta';
            replyHeader.appendChild(replyMeta);

            const replyAuthor = document.createElement('div');
            replyAuthor.className = 'webclipper-inpage-comments-panel__comment-author';
            replyAuthor.textContent = String(reply?.authorName || 'You');
            replyMeta.appendChild(replyAuthor);

            const replyTime = document.createElement('div');
            replyTime.className = 'webclipper-inpage-comments-panel__comment-time';
            replyTime.textContent = formatTime(reply?.createdAt ?? null);
            replyMeta.appendChild(replyTime);

            const replyActions = document.createElement('div');
            replyActions.className = 'webclipper-inpage-comments-panel__comment-actions';
            replyHeader.appendChild(replyActions);

            const replyDel = document.createElement('button');
            replyDel.className =
              'webclipper-inpage-comments-panel__icon-btn webclipper-btn webclipper-btn--danger-tint webclipper-btn--icon';
            replyDel.type = 'button';
            replyDel.setAttribute('data-webclipper-comment-delete-id', String(Number(reply?.id) || ''));
            replyDel.setAttribute('aria-label', t('deleteButton'));
            replyDel.textContent = '×';
            replyDel.addEventListener('click', async () => {
              if (state.busy) return;
              const id = Number(reply?.id);
              if (!Number.isFinite(id) || id <= 0) return;
              if (!deleteConfirm.isArmed(id)) {
                deleteConfirm.arm(id);
                return;
              }
              deleteConfirm.clear();
              const handler = state.handlers.onDelete;
              if (typeof handler !== 'function') return;
              try {
                state.busy = true;
                refreshButtons();
                await handler(id);
              } finally {
                state.busy = false;
                refreshButtons();
              }
            });
            replyActions.appendChild(replyDel);

            const replyBody = document.createElement('div');
            replyBody.className = 'webclipper-inpage-comments-panel__comment-body is-reply';
            replyBody.textContent = String(reply?.commentText || '');
            replyRow.appendChild(replyBody);
          }
        }

        const replyComposer = document.createElement('div');
        replyComposer.className = 'webclipper-inpage-comments-panel__reply-composer';
        thread.appendChild(replyComposer);

        const replyTextarea = document.createElement('textarea');
        replyTextarea.className = 'webclipper-inpage-comments-panel__reply-textarea';
        replyTextarea.placeholder = 'Reply…';
        replyTextarea.rows = 1;
        replyComposer.appendChild(replyTextarea);

        const replySend = document.createElement('button');
        replySend.className = 'webclipper-inpage-comments-panel__send webclipper-btn webclipper-btn--icon';
        replySend.type = 'button';
        replySend.setAttribute('aria-label', 'Reply');
        replySend.textContent = '↑';
        replyComposer.appendChild(replySend);

        (replySend as any).__webclipperTextValue = () => String((replyTextarea as any).value || '');

        autosizeTextarea(replyTextarea);
        replyTextarea.addEventListener('input', () => {
          autosizeTextarea(replyTextarea);
          refreshButtons();
        });
        const submitReply = async () => {
          if (state.busy) return;
          const text = String((replyTextarea as any).value || '').trim();
          if (!text) return;
          const handler = state.handlers.onReply;
          if (typeof handler !== 'function') return;
          try {
            state.busy = true;
            refreshButtons();
            await handler(rootId, text);
            (replyTextarea as any).value = '';
            autosizeTextarea(replyTextarea);
          } finally {
            state.busy = false;
            refreshButtons();
          }
        };

        replyTextarea.addEventListener('keydown', (e) => {
          if ((e as any).isComposing) return;
          if (e.key !== 'Enter') return;
          if (!(e.metaKey || e.ctrlKey)) return;
          if (e.shiftKey || e.altKey) return;
          e.preventDefault();
          void submitReply();
        });

        replySend.addEventListener('click', () => {
          void submitReply();
        });
      }

      refreshButtons();
    },
  };

  if (!options.overlay) {
    // Embedded mode: keep it visible by default.
    setOpen(true);
  } else {
    // Overlay mode: default to closed unless explicitly opened.
    setOpen(options.initiallyOpen === true);
  }

  refreshButtons();
  host.appendChild(el);

  const stopShortcutKeyPropagation = (e: Event) => {
    if (!isEditableTarget((e as any).target)) return;
    try {
      (e as any).stopImmediatePropagation?.();
    } catch (_e) {
      // ignore
    }
    try {
      e.stopPropagation();
    } catch (_e) {
      // ignore
    }
  };

  // Prevent site-level single-letter shortcuts: key events crossing the Shadow DOM boundary are retargeted to the host,
  // so many sites won't detect that we're typing in a textarea. Stop propagation inside the shadow root.
  try {
    shadow.addEventListener('keydown', stopShortcutKeyPropagation);
    shadow.addEventListener('keypress', stopShortcutKeyPropagation);
    shadow.addEventListener('keyup', stopShortcutKeyPropagation);
  } catch (_e) {
    // ignore
  }

  const cleanup = () => {
    // Ensure we restore page layout even if the panel is removed while open.
    try {
      setDockOpen(false);
    } catch (_e) {
      // ignore
    }
    try {
      deleteConfirm.dispose();
    } catch (_e) {
      // ignore
    }
    try {
      locateHighlighter.clear();
    } catch (_e) {
      // ignore
    }
    try {
      cleanupSidebarResize?.();
    } catch (_e) {
      // ignore
    }
    cleanupSidebarResize = null;
    try {
      shadow.removeEventListener('keydown', stopShortcutKeyPropagation);
      shadow.removeEventListener('keypress', stopShortcutKeyPropagation);
      shadow.removeEventListener('keyup', stopShortcutKeyPropagation);
    } catch (_e) {
      // ignore
    }
    try {
      el.remove();
    } catch (_e) {
      // ignore
    }
  };

  return { el, api: apiRef, cleanup };
}
