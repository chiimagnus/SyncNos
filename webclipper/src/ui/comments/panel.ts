import { t } from '@i18n';
import { createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root as ReactRoot } from 'react-dom/client';
import { createTwoStepConfirmController } from '@services/shared/two-step-confirm';
import { createChatWithMenuController } from './chatwith';
import { createDockController } from './dock';
import { createThreadLocateController } from './locate';
import { ThreadedCommentsPanel } from './react/ThreadedCommentsPanel';
import { createThreadedCommentsPanelStore, type ThreadedCommentsPanelStore } from './react/panel-store';
import {
  closeThreadCommentChatWithMenuOnEscape,
  closeThreadCommentChatWithMenus,
  renderThreadedComments,
} from './render';
import { installSidebarResize } from './resize';
import { buildThreadedCommentsPanelShadowCss } from './shadow-styles';
import type { MountOptions, ThreadedCommentsPanelApi } from './types';

type ThreadedCommentsPanelHandlers = Parameters<ThreadedCommentsPanelApi['setHandlers']>[0];
type SendButtonWithTextGetter = HTMLButtonElement & {
  __webclipperTextValue?: () => string;
};

type ThreadedCommentsPanelReactBridgeProps = {
  store: ThreadedCommentsPanelStore;
  variant: 'embedded' | 'sidebar';
  fullWidth: boolean;
  surfaceBg?: string;
  showHeader: boolean;
  showCollapseButton: boolean;
  onRequestClose: () => void;
  locateThreadRoot?: (rootId: number) => Promise<boolean>;
  onLocateFailed?: () => void;
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
    setPendingFocusRootId: props.store.setPendingFocusRootId,
    onRequestClose: props.onRequestClose,
    locateThreadRoot: props.locateThreadRoot,
    onLocateFailed: props.onLocateFailed,
  });
}

function setImportantStyle(el: HTMLElement, name: string, value: string) {
  el.style.setProperty(name, value, 'important');
}

function autosizeTextarea(textarea: HTMLTextAreaElement | null | undefined) {
  if (!textarea) return;
  try {
    textarea.style.overflowY = 'hidden';
    textarea.style.height = '0px';
    const next = Math.max(0, Number(textarea.scrollHeight || 0) || 0);
    textarea.style.height = `${next}px`;
  } catch (_e) {
    // ignore
  }
}

function isEditableTarget(target: unknown): boolean {
  const el = target as HTMLElement | null;
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
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (isEditableTarget(el)) return true;
  try {
    if (el.closest?.('button,input,textarea,a,label,select,option')) return true;
  } catch (_e) {
    // ignore
  }
  return false;
}

function setPanelTooltip(el: HTMLElement, label: string) {
  const text = String(label || '').trim();
  if (!text) {
    el.removeAttribute('data-webclipper-tooltip');
    return;
  }
  el.setAttribute('data-webclipper-tooltip', text);
}

export function mountThreadedCommentsPanel(
  host: HTMLElement,
  options: MountOptions = {},
): { el: HTMLElement; api: ThreadedCommentsPanelApi; cleanup: () => void } {
  const el = document.createElement('webclipper-threaded-comments-panel') as HTMLElement;
  const isOverlay = options.overlay === true;
  if (isOverlay) el.setAttribute('data-overlay', '1');
  const variant = options.variant === 'sidebar' ? 'sidebar' : 'embedded';
  if (variant === 'sidebar') el.setAttribute('data-variant', 'sidebar');
  const isFullWidth = options.fullWidth === true;
  if (isFullWidth) {
    el.setAttribute('data-layout', 'full-width');
    el.style.width = '100%';
    el.style.borderLeft = '0';
  }
  if (options.initiallyOpen) el.setAttribute('data-open', '1');
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
  const reactRootHost = document.createElement('div');
  reactRootHost.className = 'webclipper-inpage-comments-panel__react-root';
  setImportantStyle(reactRootHost, 'display', 'none');
  shadow.appendChild(reactRootHost);
  let apiRef: ThreadedCommentsPanelApi;
  let reactRoot: ReactRoot | null = null;
  try {
    reactRoot = createRoot(reactRootHost);
    reactRoot.render(
      createElement(ThreadedCommentsPanelReactBridge, {
        store: panelStore,
        variant,
        fullWidth: isFullWidth,
        surfaceBg: surfaceBg || undefined,
        showHeader,
        showCollapseButton,
        onRequestClose: () => apiRef?.close(),
        locateThreadRoot: async (rootId) => {
          const root = panelStore
            .getSnapshot()
            .comments.find((item) => Number(item?.id) === Number(rootId) && !item?.parentId);
          if (!root) return false;
          return await locateController.locateThreadRootWithRetry(root);
        },
        onLocateFailed: () => showNotice('无法定位'),
      }),
    );
  } catch (_e) {
    reactRoot = null;
  }

  const surface = document.createElement('div');
  surface.className = 'webclipper-inpage-comments-panel__surface';
  shadow.appendChild(surface);

  let cleanupSidebarResize: (() => void) | null = null;
  if (variant === 'sidebar' && !isFullWidth) {
    const handle = document.createElement('div');
    handle.className = 'webclipper-inpage-comments-panel__resize-handle';
    surface.appendChild(handle);
    const resize = installSidebarResize({
      panelEl: el,
      handleEl: handle,
      isOverlay,
      readPanelWidthPx: () => dockController.readWidthPx(),
      onWidthApplied: () => dockController.syncWidth(),
    });
    cleanupSidebarResize = () => resize.cleanup();
  }

  const chatWithMenuController = createChatWithMenuController({
    config: chatWithConfig,
    showNotice: (message) => showNotice(message),
  });

  if (showHeader) {
    const header = document.createElement('div');
    header.className = 'webclipper-inpage-comments-panel__header';
    surface.appendChild(header);

    const headerTitle = document.createElement('div');
    headerTitle.className = 'webclipper-inpage-comments-panel__header-title';
    headerTitle.textContent = t('articleCommentsHeading');
    header.appendChild(headerTitle);

    const headerActions = document.createElement('div');
    headerActions.className = 'webclipper-inpage-comments-panel__header-actions';
    header.appendChild(headerActions);

    if (chatWithConfig) {
      const chatWith = document.createElement('div');
      chatWith.className = 'webclipper-inpage-comments-panel__chatwith';
      headerActions.appendChild(chatWith);
      chatWithMenuController.attachRoot(chatWith);
    }

    if (showCollapseButton) {
      const collapse = document.createElement('button');
      collapse.type = 'button';
      collapse.className = 'webclipper-inpage-comments-panel__collapse webclipper-btn header-button';
      const collapseLabel = t('closeCommentsSidebar');
      collapse.setAttribute('aria-label', collapseLabel);
      setPanelTooltip(collapse, collapseLabel);
      collapse.innerHTML = [
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">',
        '<path d="M6.25 3.25L9.5 6.5L6.25 9.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />',
        '<path d="M9.3 6.5H3.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />',
        '</svg>',
      ].join('');
      collapse.addEventListener('click', () => apiRef.close());
      headerActions.appendChild(collapse);
    }
  }

  const body = document.createElement('div');
  body.className = 'webclipper-inpage-comments-panel__body';
  surface.appendChild(body);

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
  const commentLabel = t('tooltipCommentSendDetailed');
  composerSend.setAttribute('aria-label', commentLabel);
  setPanelTooltip(composerSend, commentLabel);
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
    focusComposerSignal: 0,
    noticeTimer: null as ReturnType<typeof setTimeout> | null,
    handlers: {
      onSave: undefined,
      onReply: undefined,
      onDelete: undefined,
      onClose: undefined,
    } as ThreadedCommentsPanelHandlers,
  };

  function showNotice(message: string) {
    const text = String(message || '').trim();
    if (!text) return;
    try {
      notice.textContent = text;
      notice.style.display = 'block';
      panelStore.setNotice({ message: text, visible: true });
      if (state.noticeTimer) clearTimeout(state.noticeTimer);
      state.noticeTimer = setTimeout(() => {
        notice.style.display = 'none';
        notice.textContent = '';
        panelStore.setNotice({ message: '', visible: false });
      }, 1600);
    } catch (_e) {
      // ignore
    }
  }
  const locateController = createThreadLocateController({
    locatorEnv: options.locatorEnv ?? null,
    pickLocatorRoot: () => pickLocatorRoot(options),
  });

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
      setPanelTooltip(button, t('tooltipDeleteCommentConfirmDetailed'));
    } else {
      button.removeAttribute('data-confirm');
      button.classList.remove('webclipper-btn--danger');
      button.classList.add('webclipper-btn--danger-tint');
      button.classList.add('webclipper-btn--icon');
      button.textContent = '×';
      button.setAttribute('aria-label', t('deleteButton'));
      setPanelTooltip(button, t('tooltipDeleteCommentDetailed'));
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
      if (!composerTextarea) return;
      composerTextarea.focus();
      // Put caret at the end for convenience.
      try {
        const value = String(composerTextarea.value || '');
        composerTextarea.setSelectionRange(value.length, value.length);
      } catch (_e2) {
        // ignore
      }
    } catch (_e) {
      // ignore
    }
  };

  function refreshButtons() {
    const text = String(composerTextarea.value || '').trim();
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
    ) as NodeListOf<SendButtonWithTextGetter> | null;
    sendButtons?.forEach?.((node) => {
      try {
        if (node === composerSend) return;
        const threadText = String(node.__webclipperTextValue?.() || '').trim();
        node.disabled = state.busy || !threadText;
      } catch (_e) {
        // ignore
      }
    });

    const commentChatWithTriggers = shadow.querySelectorAll?.(
      '.webclipper-inpage-comments-panel__comment-chatwith-trigger',
    ) as NodeListOf<HTMLButtonElement> | null;
    commentChatWithTriggers?.forEach?.((node) => {
      try {
        const baseDisabled = node.getAttribute('data-base-disabled') === '1';
        node.disabled = state.busy || baseDisabled;
      } catch (_e) {
        // ignore
      }
    });

    const commentChatWithMenuItems = shadow.querySelectorAll?.(
      '.webclipper-inpage-comments-panel__comment-chatwith-menu-item',
    ) as NodeListOf<HTMLButtonElement> | null;
    commentChatWithMenuItems?.forEach?.((node) => {
      try {
        const actionDisabled = node.getAttribute('data-action-disabled') === '1';
        node.disabled = state.busy || actionDisabled;
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
    panelStore.setOpen(open);
    if (open) {
      el.setAttribute('data-open', '1');
      setImportantStyle(el, 'display', 'block');
      dockController.setOpen(true);
    } else {
      chatWithMenuController.closeMenu();
      closeThreadCommentChatWithMenus(threads, null);
      el.removeAttribute('data-open');
      setImportantStyle(el, 'display', 'none');
      dockController.setOpen(false);
    }
  }

  autosizeTextarea(composerTextarea);
  composerTextarea.addEventListener('input', () => {
    autosizeTextarea(composerTextarea);
    refreshButtons();
  });
  const submitComposer = async () => {
    if (state.busy) return;
    const text = String(composerTextarea.value || '').trim();
    if (!text) return;
    const handler = state.handlers.onSave;
    if (typeof handler !== 'function') return;
    try {
      state.busy = true;
      refreshButtons();
      await handler(text);
      composerTextarea.value = '';
      autosizeTextarea(composerTextarea);
    } finally {
      state.busy = false;
      refreshButtons();
    }
  };

  composerTextarea.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.isComposing) return;
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
    const target = e.target as Element | null;
    chatWithMenuController.handleShadowClick(target);
    closeThreadCommentChatWithMenus(threads, target);
    if (deleteConfirm.getArmedKey() == null) return;
    const currentTarget = e.target as Element | null;
    try {
      const deleteButton = currentTarget?.closest?.('button[data-webclipper-comment-delete-id]');
      if (deleteButton) return;
    } catch (_e) {
      // ignore
    }
    deleteConfirm.clear();
  });

  shadow.addEventListener('keydown', (e) => {
    const keyEvent = e as KeyboardEvent;
    if (keyEvent.isComposing) return;
    if (keyEvent.key === 'Escape' && chatWithMenuController.handleShadowEscape(keyEvent)) {
      return;
    }
    if (keyEvent.key === 'Escape' && closeThreadCommentChatWithMenuOnEscape(threads)) {
      try {
        keyEvent.preventDefault();
      } catch (_e) {
        // ignore
      }
      return;
    }
    if (deleteConfirm.getArmedKey() == null) return;
    if (keyEvent.key !== 'Escape') return;
    try {
      keyEvent.preventDefault();
    } catch (_e) {
      // ignore
    }
    deleteConfirm.clear();
  });

  apiRef = {
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
        state.focusComposerSignal += 1;
        panelStore.setFocusComposerSignal(state.focusComposerSignal);
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
      panelStore.setBusy(state.busy);
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
      panelStore.setQuoteText(value);
    },
    setHandlers(handlers: ThreadedCommentsPanelHandlers) {
      state.handlers = handlers || {
        onSave: null,
        onReply: null,
        onDelete: null,
        onClose: null,
      };
      panelStore.setHandlers(state.handlers);
    },
    setComments(items) {
      panelStore.setComments(items);
      renderThreadedComments({
        items,
        threadsEl: threads,
        emptyEl: empty,
        variant,
        isBusy: () => state.busy,
        setBusy: (busy) => {
          state.busy = Boolean(busy);
        },
        onBusyChanged: () => refreshButtons(),
        onDelete: state.handlers.onDelete,
        onReply: state.handlers.onReply,
        deleteConfirm,
        shouldIgnoreLocateClick,
        locateThreadRoot: (root) => locateController.locateThreadRootWithRetry(root),
        onLocateFailed: () => showNotice('无法定位'),
        formatTime,
        autosizeTextarea,
        commentChatWith: commentChatWithConfig,
        showNotice,
      });
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
    if (!isEditableTarget(e.target)) return;
    try {
      e.stopImmediatePropagation();
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
  const onShadowFocusIn = () => {
    panelStore.setHasFocusWithinPanel(true);
  };
  const onShadowFocusOut = () => {
    try {
      panelStore.setHasFocusWithinPanel(Boolean(shadow.activeElement));
    } catch (_e) {
      panelStore.setHasFocusWithinPanel(false);
    }
  };
  try {
    shadow.addEventListener('focusin', onShadowFocusIn);
    shadow.addEventListener('focusout', onShadowFocusOut);
  } catch (_e) {
    // ignore
  }

  const cleanup = () => {
    // Ensure we restore page layout even if the panel is removed while open.
    try {
      dockController.cleanup();
    } catch (_e) {
      // ignore
    }
    try {
      deleteConfirm.dispose();
    } catch (_e) {
      // ignore
    }
    try {
      locateController.clear();
    } catch (_e) {
      // ignore
    }
    try {
      cleanupSidebarResize?.();
    } catch (_e) {
      // ignore
    }
    cleanupSidebarResize = null;
    chatWithMenuController.cleanup();
    try {
      shadow.removeEventListener('keydown', stopShortcutKeyPropagation);
      shadow.removeEventListener('keypress', stopShortcutKeyPropagation);
      shadow.removeEventListener('keyup', stopShortcutKeyPropagation);
    } catch (_e) {
      // ignore
    }
    try {
      shadow.removeEventListener('focusin', onShadowFocusIn);
      shadow.removeEventListener('focusout', onShadowFocusOut);
    } catch (_e) {
      // ignore
    }
    try {
      reactRoot?.unmount();
    } catch (_e) {
      // ignore
    }
    reactRoot = null;
    try {
      el.remove();
    } catch (_e) {
      // ignore
    }
  };

  return { el, api: apiRef, cleanup };
}
