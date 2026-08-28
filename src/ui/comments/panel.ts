import { createElement, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root as ReactRoot } from 'react-dom/client';

import { normalizeArticleCommentLocator, type ArticleCommentLocator } from '@services/comments/domain/comment-locator';
import { resolveCommentAnchor } from '@services/comments/locator/resolve-comment-anchor';
import type { CommentSidebarHostActions } from '@services/comments/sidebar/comment-sidebar-contract';

import { createCommentAnchorController } from './comment-anchor-controller';
import { createDockController } from './dock';
import { createCommentRangeMarkerRegistry } from './range-marker-registry';
import { scrollExactCommentRange, type CommentScrollContainer } from './range-scroll-controller';
import { ThreadedCommentsPanel } from './react/ThreadedCommentsPanel';
import { createThreadedCommentsPanelStore, type ThreadedCommentsPanelStore } from './react/panel-store';
import type { ThreadLocateResult } from './react/types';
import { installSidebarResize } from './resize';
import { buildThreadedCommentsPanelShadowCss } from './shadow-styles';
import type { MountOptions, ThreadedCommentsPanelApi } from './types';

type ThreadedCommentsPanelReactBridgeProps = {
  store: ThreadedCommentsPanelStore;
  actions: CommentSidebarHostActions;
  setPendingFocusRootId: (rootId: number | null) => void;
  variant: 'sidebar';
  fullWidth: boolean;
  surfaceBg?: string;
  showHeader: boolean;
  showCollapseButton: boolean;
  onRequestClose: () => void;
  locateThreadRoot?: (rootId: number) => Promise<ThreadLocateResult>;
  onActiveRootChange?: (rootId: number | null) => void;
  onLocateFailed?: (reason: string) => void;
  showNotice: (message: string) => void;
  onNoticeExpired: () => void;
};

function ThreadedCommentsPanelReactBridge(props: ThreadedCommentsPanelReactBridgeProps) {
  const snapshot = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot, props.store.getSnapshot);
  return createElement(ThreadedCommentsPanel, {
    variant: props.variant,
    fullWidth: props.fullWidth,
    surfaceBg: props.surfaceBg,
    showHeader: props.showHeader,
    showCollapseButton: props.showCollapseButton,
    snapshot,
    actions: props.actions,
    onRequestClose: props.onRequestClose,
    setPendingFocusRootId: props.setPendingFocusRootId,
    locateThreadRoot: props.locateThreadRoot,
    onActiveRootChange: props.onActiveRootChange,
    onLocateFailed: props.onLocateFailed,
    showNotice: props.showNotice,
    onNoticeExpired: props.onNoticeExpired,
  });
}

function setImportantStyle(el: HTMLElement, name: string, value: string) {
  el.style.setProperty(name, value, 'important');
}

function syncReactUpdate(run: () => void) {
  try {
    flushSync(run);
  } catch (_e) {
    run();
  }
}

function asyncReactUpdate(run: () => void) {
  const schedule =
    typeof globalThis.queueMicrotask === 'function'
      ? globalThis.queueMicrotask.bind(globalThis)
      : (cb: () => void) => Promise.resolve().then(cb);
  schedule(run);
}

function readLocatorSurfaceRoots(options: MountOptions) {
  const getter = options.getLocatorSurfaceRoots;
  if (typeof getter !== 'function') return null;
  try {
    return getter() || null;
  } catch (_error) {
    return null;
  }
}

function readLocatorRoots(options: MountOptions, locator: ArticleCommentLocator): readonly Element[] {
  if (typeof options.getLocatorRoots === 'function') {
    try {
      return Array.from(options.getLocatorRoots(locator) || [])
        .filter((root): root is Element => !!root)
        .slice(0, 8);
    } catch (_error) {
      return [];
    }
  }
  const roots = readLocatorSurfaceRoots(options);
  return roots?.sourceRoot ? [roots.sourceRoot] : [];
}

function rangeElement(range: Range): Element | null {
  const node = range.commonAncestorContainer || range.startContainer;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

function composedParentElement(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode?.();
  return root && 'host' in root ? (root as ShadowRoot).host || null : null;
}

function isScrollableElement(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  try {
    const style = view?.getComputedStyle?.(element);
    const overflow = `${style?.overflowY || ''} ${style?.overflow || ''}`;
    return (
      /(auto|scroll|overlay)/.test(overflow) &&
      Number((element as HTMLElement).scrollHeight || 0) > Number((element as HTMLElement).clientHeight || 0)
    );
  } catch (_error) {
    return false;
  }
}

function createElementScrollContainer(element: Element): CommentScrollContainer {
  const target = element as HTMLElement;
  return {
    getRect: () => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    },
    getScrollTop: () => Number(target.scrollTop || 0),
    getScrollHeight: () => Number(target.scrollHeight || 0),
    getClientHeight: () => Number(target.clientHeight || 0),
    scrollTo: (top, behavior) => {
      try {
        if (typeof target.scrollTo === 'function') {
          target.scrollTo({ top, behavior });
          return;
        }
      } catch (_error) {
        // Fall through to direct assignment for DOM implementations without scrollTo.
      }
      target.scrollTop = top;
    },
  };
}

function collectScrollContainers(range: Range, explicitScrollRoot: Element): CommentScrollContainer[] {
  const elements: Element[] = [];
  let cursor = rangeElement(range);
  while (cursor) {
    if (cursor === explicitScrollRoot) {
      elements.push(cursor);
      break;
    }
    if (isScrollableElement(cursor)) elements.push(cursor);
    cursor = composedParentElement(cursor);
  }
  if (!elements.includes(explicitScrollRoot)) elements.push(explicitScrollRoot);
  return elements.map(createElementScrollContainer);
}

function pickScrollRoot(options: MountOptions, range: Range, resolvedRoot: Element): Element {
  const configured = readLocatorSurfaceRoots(options);
  if (configured) {
    try {
      if (configured.sourceRoot === resolvedRoot || configured.sourceRoot.contains(range.startContainer)) {
        return configured.scrollRoot;
      }
    } catch (_error) {
      // Continue with a bounded ancestor lookup.
    }
  }
  let cursor: Element | null = rangeElement(range) || resolvedRoot;
  while (cursor) {
    if (isScrollableElement(cursor)) return cursor;
    cursor = composedParentElement(cursor);
  }
  return resolvedRoot.ownerDocument.scrollingElement || resolvedRoot.ownerDocument.documentElement;
}

function readViewportRect(document: Document) {
  const view = document.defaultView;
  const width = Number(view?.innerWidth || document.documentElement.clientWidth || 0);
  const height = Number(view?.innerHeight || document.documentElement.clientHeight || 0);
  return { top: 0, bottom: height, left: 0, right: width, width, height };
}

function prefersReducedMotion(document: Document): boolean {
  try {
    return document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch (_error) {
    return false;
  }
}

function locateFailureNotice(reason: string): string {
  if (reason === 'budget_exceeded') return '内容过大，无法精确定位';
  if (reason === 'ambiguous_root' || reason === 'ambiguous_quote') return '存在多个匹配位置，无法精确定位';
  if (reason === 'missing_locator') return '该评论没有定位信息';
  if (reason === 'missing_root') return '当前内容区域不可定位';
  return '无法定位原文';
}

export function mountThreadedCommentsPanel(
  host: HTMLElement,
  options: MountOptions = {},
): { el: HTMLElement; api: ThreadedCommentsPanelApi; cleanup: () => void } {
  const el = document.createElement('webclipper-threaded-comments-panel') as HTMLElement;
  const isOverlay = options.overlay === true;
  const variant = 'sidebar' as const;
  const isFullWidth = options.fullWidth === true;
  const surface = options.surface || (isOverlay ? 'inpage' : isFullWidth ? 'app-narrow' : 'app-wide');
  const showHeader = options.showHeader !== false;
  const showCollapseButton = options.showCollapseButton ?? options.overlay === true;
  const dockPage = options.dockPage === true && options.overlay === true;
  const surfaceBg = String(options.surfaceBg || '').trim();
  let disposed = false;
  const runReactUpdate =
    options.deferReactUpdates === true
      ? (run: () => void) =>
          asyncReactUpdate(() => {
            if (!disposed) run();
          })
      : syncReactUpdate;
  if (isOverlay) el.setAttribute('data-overlay', '1');
  if (variant === 'sidebar') el.setAttribute('data-variant', 'sidebar');
  el.setAttribute('data-surface', surface);
  if (isFullWidth) {
    el.setAttribute('data-layout', 'full-width');
    el.style.width = '100%';
    el.style.borderLeft = '0';
  }
  if (options.initiallyOpen) el.setAttribute('data-open', '1');

  const SURFACE_BG_CSS_VAR = '--webclipper-comments-panel-surface-bg';
  if (surfaceBg) {
    setImportantStyle(el, SURFACE_BG_CSS_VAR, surfaceBg);
  }

  const HEADER_DIVIDER_CSS_VAR = '--webclipper-comments-panel-header-divider';
  const headerDivider = options.headerDivider ?? variant !== 'sidebar';
  setImportantStyle(el, HEADER_DIVIDER_CSS_VAR, headerDivider && showHeader ? '1px solid var(--panel-border)' : '0');

  const dockController = createDockController({
    enabled: dockPage,
    panelEl: el,
  });

  const shadow = el.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = buildThreadedCommentsPanelShadowCss();
  shadow.appendChild(style);

  const panelController = createThreadedCommentsPanelStore();
  const panelStore = panelController.store;
  const panelDocument = host.ownerDocument;
  const markerRegistry = createCommentRangeMarkerRegistry({
    document: panelDocument,
    window: panelDocument.defaultView || undefined,
    styleSource: el,
    renderMode: options.locatorEnv === 'app' ? 'native' : 'overlay',
    getGeometryRoots: () => {
      const roots = readLocatorSurfaceRoots(options);
      return roots ? [roots.sourceRoot, roots.scrollRoot] : [];
    },
  });
  const anchorController = createCommentAnchorController({
    getRoots: (locator) => readLocatorRoots(options, locator),
    registry: markerRegistry,
    resolve: ({ locator, roots, signal, generation, budget }) => {
      if (!roots.length) return { ok: false, reason: 'missing_root' };
      return resolveCommentAnchor({
        locator,
        roots,
        signal,
        generation,
        isGenerationCurrent: (candidate) => candidate === anchorController.getGeneration(),
        budget,
      });
    },
  });
  const readAnchorItems = () =>
    panelStore
      .getSnapshot()
      .comments.filter((item) => item.parentId == null)
      .map((item) => ({ commentId: Number(item.id), locator: normalizeArticleCommentLocator(item.locator) }));
  const syncAnchorMarkers = async () => {
    if (disposed) return;
    if (!panelStore.getSnapshot().open) {
      anchorController.reset();
      return;
    }
    await anchorController.sync(readAnchorItems());
  };
  const scheduleNoticeUpdate = (run: () => void) => {
    asyncReactUpdate(() => {
      if (disposed) return;
      runReactUpdate(run);
    });
  };
  const showNotice = (message: string) => {
    if (disposed) return;
    const text = String(message || '').trim();
    if (!text) return;
    scheduleNoticeUpdate(() => {
      panelController.setNotice({ message: text, visible: true });
    });
  };
  const expireNotice = () => {
    if (disposed) return;
    scheduleNoticeUpdate(() => {
      panelController.setNotice({ message: '', visible: false });
    });
  };

  const reactRootHost = document.createElement('div');
  reactRootHost.className = 'webclipper-inpage-comments-panel__react-root';
  setImportantStyle(reactRootHost, 'display', 'block');
  setImportantStyle(reactRootHost, 'height', '100%');
  shadow.appendChild(reactRootHost);

  let cleanupSidebarResize: (() => void) | null = null;
  if (variant === 'sidebar' && !isFullWidth) {
    const handle = document.createElement('div');
    handle.className = 'webclipper-inpage-comments-panel__resize-handle';
    shadow.appendChild(handle);
    const resize = installSidebarResize({
      panelEl: el,
      handleEl: handle,
      isOverlay,
      readPanelWidthPx: () => dockController.readWidthPx(),
      onWidthApplied: () => dockController.syncWidth(),
    });
    cleanupSidebarResize = () => resize.cleanup();
  }

  let apiRef: ThreadedCommentsPanelApi;
  const reactRoot: ReactRoot = createRoot(reactRootHost);
  runReactUpdate(() => {
    reactRoot.render(
      createElement(ThreadedCommentsPanelReactBridge, {
        store: panelStore,
        actions: panelController.actions,
        setPendingFocusRootId: panelController.setPendingFocusRootId,
        variant,
        fullWidth: isFullWidth,
        surfaceBg: surfaceBg || undefined,
        showHeader,
        showCollapseButton,
        onRequestClose: () => panelController.actions.close(),
        locateThreadRoot: async (rootId) => {
          const root = panelStore
            .getSnapshot()
            .comments.find((item) => Number(item?.id) === Number(rootId) && item?.parentId == null);
          if (!root) return { ok: false, reason: 'missing_locator' };
          const locator = normalizeArticleCommentLocator(root.locator);
          const result = await anchorController.locate({ commentId: Number(root.id), locator });
          if (!result.ok) return result;
          try {
            const scrollRoot = pickScrollRoot(options, result.range, result.root);
            scrollExactCommentRange({
              range: result.range,
              containers: collectScrollContainers(result.range, scrollRoot),
              viewportRect: readViewportRect(result.root.ownerDocument),
              reducedMotion: prefersReducedMotion(result.root.ownerDocument),
            });
          } catch (_error) {
            return { ok: false, reason: 'scroll_failed' };
          }
          return { ok: true };
        },
        onActiveRootChange: (rootId) => anchorController.setActive(rootId),
        onLocateFailed: (reason) => showNotice(locateFailureNotice(reason)),
        showNotice,
        onNoticeExpired: expireNotice,
      }),
    );
  });

  const applyOpenState = (open: boolean) => {
    if (open) {
      el.setAttribute('data-open', '1');
      setImportantStyle(el, 'display', 'block');
      dockController.setOpen(true);
      return;
    }
    el.removeAttribute('data-open');
    setImportantStyle(el, 'display', 'none');
    dockController.setOpen(false);
    anchorController.reset();
  };

  let appliedOpen: boolean | null = null;
  let appliedMarkerKey = '';
  const syncHostEffects = () => {
    if (disposed) return;
    const snapshot = panelStore.getSnapshot();
    if (appliedOpen !== snapshot.open) {
      appliedOpen = snapshot.open;
      applyOpenState(snapshot.open);
    }
    const markerKey = snapshot.open
      ? snapshot.comments
          .filter((item) => item.parentId == null)
          .map((item) => `${item.id}:${item.updatedAt}:${JSON.stringify(normalizeArticleCommentLocator(item.locator))}`)
          .join('|')
      : '';
    if (markerKey === appliedMarkerKey) return;
    appliedMarkerKey = markerKey;
    void syncAnchorMarkers();
  };
  let unsubscribeHostEffects: (() => void) | null = null;

  const onShadowFocusIn = () => {
    asyncReactUpdate(() => {
      panelController.setHasFocusWithinPanel(true);
    });
  };
  const onShadowFocusOut = () => {
    try {
      asyncReactUpdate(() => {
        panelController.setHasFocusWithinPanel(Boolean(shadow.activeElement));
      });
    } catch (_e) {
      asyncReactUpdate(() => {
        panelController.setHasFocusWithinPanel(false);
      });
    }
  };

  try {
    shadow.addEventListener('focusin', onShadowFocusIn);
    shadow.addEventListener('focusout', onShadowFocusOut);
  } catch (_e) {
    // ignore
  }

  apiRef = {
    attachHost(host) {
      if (disposed) return Object.freeze({ dispose() {} });
      return panelController.attachHost(host);
    },
    refreshLocatorRoots() {
      if (disposed) return;
      anchorController.reset();
      appliedMarkerKey = '';
      void syncAnchorMarkers();
    },
  };

  host.appendChild(el);
  unsubscribeHostEffects = panelStore.subscribe(syncHostEffects);
  syncHostEffects();

  const cleanup = () => {
    if (disposed) return;
    disposed = true;

    const cleanupSteps: Array<() => void> = [
      () => {
        unsubscribeHostEffects?.();
        unsubscribeHostEffects = null;
      },
      () => {
        shadow.removeEventListener('focusin', onShadowFocusIn);
        shadow.removeEventListener('focusout', onShadowFocusOut);
      },
      () => panelController.dispose(),
      () => {
        cleanupSidebarResize?.();
        cleanupSidebarResize = null;
      },
      () => anchorController.dispose(),
      () => dockController.cleanup(),
      () => {
        const activeEl = shadow.activeElement as HTMLElement | null;
        activeEl?.blur?.();
      },
      () => {
        const unmountAndRemove = () => {
          try {
            if (reactRootHost.ownerDocument.defaultView) reactRoot.unmount();
          } catch (_error) {
            // The owning document may already be gone during test/browser teardown.
          } finally {
            el.remove();
          }
        };
        if (options.deferReactUpdates === true) asyncReactUpdate(unmountAndRemove);
        else syncReactUpdate(unmountAndRemove);
      },
    ];

    for (const step of cleanupSteps) {
      try {
        step();
      } catch (_error) {
        // Continue teardown so one failed subsystem cannot leak the rest.
      }
    }
  };

  return { el, api: apiRef, cleanup };
}
