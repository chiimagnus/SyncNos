import { createElement, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root as ReactRoot } from 'react-dom/client';

import { createChatWithMenuController } from './chatwith';
import { createDockController } from './dock';
import { createThreadLocateController } from './locate';
import { ThreadedCommentsPanel } from './react/ThreadedCommentsPanel';
import { createThreadedCommentsPanelStore, type ThreadedCommentsPanelStore } from './react/panel-store';
import { installSidebarResize } from './resize';
import { buildThreadedCommentsPanelShadowCss } from './shadow-styles';
import type { MountOptions, ThreadedCommentsPanelApi } from './types';

type ThreadedCommentsPanelHandlers = Parameters<ThreadedCommentsPanelApi['setHandlers']>[0];

type ThreadedCommentsPanelReactBridgeProps = {
  store: ThreadedCommentsPanelStore;
  handlersRef: { current: ThreadedCommentsPanelHandlers };
  variant: 'embedded' | 'sidebar';
  fullWidth: boolean;
  surfaceBg?: string;
  showHeader: boolean;
  showCollapseButton: boolean;
  showHeaderChatWith: boolean;
  commentChatWith: MountOptions['commentChatWith'];
  onRequestClose: () => void;
  onHeaderChatWithRootChange?: (el: HTMLDivElement | null) => void;
  locateThreadRoot?: (rootId: number) => Promise<boolean>;
  onLocateFailed?: () => void;
  showNotice: (message: string) => void;
};

function ThreadedCommentsPanelReactBridge(props: ThreadedCommentsPanelReactBridgeProps) {
  const snapshot = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot, props.store.getSnapshot);
  return createElement(ThreadedCommentsPanel, {
    variant: props.variant,
    fullWidth: props.fullWidth,
    surfaceBg: props.surfaceBg,
    showHeader: props.showHeader,
    showCollapseButton: props.showCollapseButton,
    showHeaderChatWith: props.showHeaderChatWith,
    snapshot,
    readHandlers: () => props.handlersRef.current,
    onRequestClose: props.onRequestClose,
    onHeaderChatWithRootChange: props.onHeaderChatWithRootChange,
    setPendingFocusRootId: props.store.setPendingFocusRootId,
    locateThreadRoot: props.locateThreadRoot,
    onLocateFailed: props.onLocateFailed,
    commentChatWith: props.commentChatWith || null,
    showNotice: props.showNotice,
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

function isEditableTarget(target: unknown): boolean {
  const el = target as HTMLElement | null;
  const tag = String(el?.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
  try {
    if (el?.isContentEditable) return true;
  } catch (_e) {
    // ignore
  }
  return false;
}

function pickLocatorRoot(options: MountOptions): Element | null {
  const getter = options.getLocatorRoot;
  if (typeof getter !== 'function') return null;
  try {
    return getter() || null;
  } catch (_e) {
    return null;
  }
}

export function mountThreadedCommentsPanel(
  host: HTMLElement,
  options: MountOptions = {},
): { el: HTMLElement; api: ThreadedCommentsPanelApi; cleanup: () => void } {
  const el = document.createElement('webclipper-threaded-comments-panel') as HTMLElement;
  const isOverlay = options.overlay === true;
  const variant = options.variant === 'sidebar' ? 'sidebar' : 'embedded';
  const isFullWidth = options.fullWidth === true;
  const showHeader = options.showHeader !== false;
  const showCollapseButton = options.showCollapseButton ?? options.overlay === true;
  const dockPage = options.dockPage === true && options.overlay === true;
  const chatWithConfig =
    options.chatWith && typeof options.chatWith.resolveActions === 'function' ? options.chatWith : null;
  const commentChatWithConfig =
    options.commentChatWith && typeof options.commentChatWith.resolveActions === 'function'
      ? options.commentChatWith
      : null;
  const surfaceBg = String(options.surfaceBg || '').trim();
  let focusComposerSignal = 0;
  let escapeSignal = 0;
  let shortcutSubmitInFlight = false;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const handlersRef: { current: ThreadedCommentsPanelHandlers } = {
    current: {
      onSave: undefined,
      onReply: undefined,
      onDelete: undefined,
      onClose: undefined,
      onComposerSelectionRequest: undefined,
    },
  };

  if (isOverlay) el.setAttribute('data-overlay', '1');
  if (variant === 'sidebar') el.setAttribute('data-variant', 'sidebar');
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

  const panelStore = createThreadedCommentsPanelStore();
  const locateController = createThreadLocateController({
    locatorEnv: options.locatorEnv ?? null,
    pickLocatorRoot: () => pickLocatorRoot(options),
  });
  const showNotice = (message: string) => {
    const text = String(message || '').trim();
    if (!text) return;
    syncReactUpdate(() => {
      panelStore.setNotice({ message: text, visible: true });
    });
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      syncReactUpdate(() => {
        panelStore.setNotice({ message: '', visible: false });
      });
      noticeTimer = null;
    }, 1600);
  };

  const chatWithMenuController = createChatWithMenuController({
    config: chatWithConfig,
    showNotice,
  });

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
  syncReactUpdate(() => {
    reactRoot.render(
      createElement(ThreadedCommentsPanelReactBridge, {
        store: panelStore,
        handlersRef,
        variant,
        fullWidth: isFullWidth,
        surfaceBg: surfaceBg || undefined,
        showHeader,
        showCollapseButton,
        showHeaderChatWith: Boolean(chatWithConfig),
        commentChatWith: commentChatWithConfig,
        onRequestClose: () => apiRef.close(),
        onHeaderChatWithRootChange: (rootEl) => {
          if (!chatWithConfig || !rootEl) return;
          chatWithMenuController.attachRoot(rootEl);
        },
        locateThreadRoot: async (rootId) => {
          const root = panelStore
            .getSnapshot()
            .comments.find((item) => Number(item?.id) === Number(rootId) && item?.parentId == null);
          if (!root) return false;
          return await locateController.locateThreadRootWithRetry(root);
        },
        onLocateFailed: () => showNotice('无法定位'),
        showNotice,
      }),
    );
  });

  const setOpen = (open: boolean) => {
    syncReactUpdate(() => {
      panelStore.setOpen(open);
    });
    if (open) {
      el.setAttribute('data-open', '1');
      setImportantStyle(el, 'display', 'block');
      dockController.setOpen(true);
      return;
    }
    chatWithMenuController.closeMenu();
    el.removeAttribute('data-open');
    setImportantStyle(el, 'display', 'none');
    dockController.setOpen(false);
  };

  const onShadowClick = (event: Event) => {
    chatWithMenuController.handleShadowClick(event.target as Element | null);
  };
  const onShadowKeydown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.isComposing) return;
    if (keyEvent.key === 'Escape' && chatWithMenuController.handleShadowEscape(keyEvent)) return;
    if (keyEvent.key !== 'Escape') return;
    escapeSignal += 1;
    syncReactUpdate(() => {
      panelStore.setEscapeSignal(escapeSignal);
    });
  };
  const onShadowShortcutSubmitCapture = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.isComposing) return;
    if (keyEvent.key !== 'Enter') return;
    if (!(keyEvent.metaKey || keyEvent.ctrlKey)) return;
    if (keyEvent.shiftKey || keyEvent.altKey) return;

    const target = event.target as HTMLElement | null;
    const textarea = target?.closest(
      'textarea.webclipper-inpage-comments-panel__composer-textarea,textarea.webclipper-inpage-comments-panel__reply-textarea',
    ) as HTMLTextAreaElement | null;
    if (!textarea) return;

    try {
      keyEvent.preventDefault();
    } catch (_e) {
      // ignore
    }
    try {
      keyEvent.stopImmediatePropagation();
    } catch (_e) {
      // ignore
    }
    try {
      keyEvent.stopPropagation();
    } catch (_e) {
      // ignore
    }

    if (shortcutSubmitInFlight || panelStore.getSnapshot().busy) return;
    const text = String(textarea.value || '').trim();
    if (!text) return;

    if (textarea.classList.contains('webclipper-inpage-comments-panel__composer-textarea')) {
      const onSave = handlersRef.current.onSave;
      if (typeof onSave !== 'function') return;
      shortcutSubmitInFlight = true;
      void Promise.resolve(onSave(text))
        .then((result) => {
          const createdRootId = Number((result as any)?.createdRootId);
          if (Number.isFinite(createdRootId) && createdRootId > 0) {
            syncReactUpdate(() => {
              panelStore.setPendingFocusRootId(Math.round(createdRootId));
            });
          }
          try {
            textarea.value = '';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } catch (_e) {
            // ignore
          }
        })
        .finally(() => {
          shortcutSubmitInFlight = false;
        });
      return;
    }

    const onReply = handlersRef.current.onReply;
    if (typeof onReply !== 'function') return;
    const thread = textarea.closest('.webclipper-inpage-comments-panel__thread') as HTMLElement | null;
    const rootId = Number(thread?.getAttribute('data-thread-root-id') || 0);
    if (!Number.isFinite(rootId) || rootId <= 0) return;

    shortcutSubmitInFlight = true;
    void Promise.resolve(onReply(Math.round(rootId), text))
      .then(() => {
        syncReactUpdate(() => {
          panelStore.setPendingFocusRootId(Math.round(rootId));
        });
        try {
          textarea.value = '';
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (_e) {
          // ignore
        }
      })
      .finally(() => {
        shortcutSubmitInFlight = false;
      });
  };
  const onShadowFocusIn = () => {
    syncReactUpdate(() => {
      panelStore.setHasFocusWithinPanel(true);
    });
  };
  const onShadowFocusOut = () => {
    try {
      syncReactUpdate(() => {
        panelStore.setHasFocusWithinPanel(Boolean(shadow.activeElement));
      });
    } catch (_e) {
      syncReactUpdate(() => {
        panelStore.setHasFocusWithinPanel(false);
      });
    }
  };

  const stopShortcutKeyPropagation = (event: Event) => {
    if (!isEditableTarget(event.target)) return;
    try {
      event.stopPropagation();
    } catch (_e) {
      // ignore
    }
  };

  try {
    shadow.addEventListener('keydown', onShadowShortcutSubmitCapture, true);
    shadow.addEventListener('click', onShadowClick);
    shadow.addEventListener('keydown', onShadowKeydown);
    shadow.addEventListener('focusin', onShadowFocusIn);
    shadow.addEventListener('focusout', onShadowFocusOut);
    shadow.addEventListener('keydown', stopShortcutKeyPropagation);
    shadow.addEventListener('keypress', stopShortcutKeyPropagation);
    shadow.addEventListener('keyup', stopShortcutKeyPropagation);
  } catch (_e) {
    // ignore
  }

  apiRef = {
    open(input) {
      setOpen(true);
      if (input?.focusComposer) {
        focusComposerSignal += 1;
        syncReactUpdate(() => {
          panelStore.setFocusComposerSignal(focusComposerSignal);
        });
      }
      apiRef.setBusy(false);
    },
    close() {
      setOpen(false);
      const handler = handlersRef.current.onClose;
      if (typeof handler === 'function') {
        handler();
      }
    },
    isOpen() {
      return el.getAttribute('data-open') === '1' && (getComputedStyle(el).display || '') !== 'none';
    },
    setBusy(busy) {
      syncReactUpdate(() => {
        panelStore.setBusy(Boolean(busy));
      });
    },
    setQuoteText(text) {
      syncReactUpdate(() => {
        panelStore.setQuoteText(String(text || ''));
      });
    },
    setComments(items) {
      syncReactUpdate(() => {
        panelStore.setComments(Array.isArray(items) ? items : []);
      });
    },
    setHandlers(handlers: ThreadedCommentsPanelHandlers) {
      handlersRef.current = handlers || {
        onSave: undefined,
        onReply: undefined,
        onDelete: undefined,
        onClose: undefined,
        onComposerSelectionRequest: undefined,
      };
      syncReactUpdate(() => {
        panelStore.setHandlers(handlersRef.current);
      });
    },
  };

  if (!options.overlay) {
    setOpen(true);
  } else {
    setOpen(options.initiallyOpen === true);
  }

  host.appendChild(el);

  const cleanup = () => {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    try {
      dockController.cleanup();
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
      locateController.clear();
    } catch (_e) {
      // ignore
    }
    try {
      chatWithMenuController.cleanup();
    } catch (_e) {
      // ignore
    }
    try {
      shadow.removeEventListener('keydown', onShadowShortcutSubmitCapture, true);
      shadow.removeEventListener('click', onShadowClick);
      shadow.removeEventListener('keydown', onShadowKeydown);
      shadow.removeEventListener('focusin', onShadowFocusIn);
      shadow.removeEventListener('focusout', onShadowFocusOut);
      shadow.removeEventListener('keydown', stopShortcutKeyPropagation);
      shadow.removeEventListener('keypress', stopShortcutKeyPropagation);
      shadow.removeEventListener('keyup', stopShortcutKeyPropagation);
    } catch (_e) {
      // ignore
    }
    try {
      const activeEl = shadow.activeElement as HTMLElement | null;
      activeEl?.blur?.();
    } catch (_e) {
      // ignore
    }
    syncReactUpdate(() => {
      try {
        reactRoot.unmount();
      } catch (_e) {
        // ignore
      }
    });
    try {
      el.remove();
    } catch (_e) {
      // ignore
    }
  };

  return { el, api: apiRef, cleanup };
}
