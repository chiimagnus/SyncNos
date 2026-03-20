import { t } from '../../i18n';
import inpageCommentsPanelCssRaw from '../styles/inpage-comments-panel.css?raw';
import buttonsCssRaw from '../styles/buttons.css?raw';
import tokensCssRaw from '../styles/tokens.css?raw';

export type ThreadedCommentItem = {
  id: number;
  parentId: number | null;
  authorName?: string | null;
  createdAt?: number | null;
  quoteText?: string | null;
  commentText: string;
};

export type ThreadedCommentsPanelApi = {
  open: (input?: { focusComposer?: boolean }) => void;
  close: () => void;
  isOpen: () => boolean;
  setBusy: (busy: boolean) => void;
  setQuoteText: (text: string) => void;
  setComments: (items: ThreadedCommentItem[]) => void;
  setHandlers: (handlers: {
    onSave?: (text: string) => void | Promise<void>;
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

type MountOptions = {
  overlay?: boolean;
  initiallyOpen?: boolean;
  showHeader?: boolean;
  showCollapseButton?: boolean;
  // When `true`, opening the overlay panel will "dock" the host page content by
  // applying right padding to `document.documentElement` so the page is not
  // covered by the sidebar. Intended for inpage content-scripts only.
  dockPage?: boolean;
};

export function mountThreadedCommentsPanel(
  host: HTMLElement,
  options: MountOptions = {},
): { el: HTMLElement; api: ThreadedCommentsPanelApi; cleanup: () => void } {
  const el = document.createElement('webclipper-threaded-comments-panel') as any as HTMLElement;
  if (options.overlay) el.setAttribute('data-overlay', '1');
  if (options.initiallyOpen) el.setAttribute('data-open', '1');
  const showHeader = options.showHeader !== false;
  const showCollapseButton = options.showCollapseButton ?? options.overlay === true;
  const dockPage = options.dockPage === true && options.overlay === true;

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
      const w = Number.parseFloat(String((computed as any)?.width || '').replace('px', '').trim());
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

  const syncThemeAttr = () => {
    const theme = document.documentElement?.getAttribute?.('data-theme');
    if (theme === 'light' || theme === 'dark') {
      el.setAttribute('data-theme', theme);
    } else {
      el.removeAttribute('data-theme');
    }
  };
  syncThemeAttr();

  let themeObserver: MutationObserver | null = null;
  try {
    if (typeof MutationObserver !== 'undefined') {
      themeObserver = new MutationObserver(() => syncThemeAttr());
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  } catch (_e) {
    themeObserver = null;
  }

  const shadow = el.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_SHADOW_CSS;
  shadow.appendChild(style);

  const surface = document.createElement('div');
  surface.className = 'webclipper-inpage-comments-panel__surface';
  shadow.appendChild(surface);

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
  composerTextarea.rows = 2;
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
    handlers: {
      onSave: null as any,
      onReply: null as any,
      onDelete: null as any,
      onClose: null as any,
    },
  };

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

    const replyInputs = shadow.querySelectorAll?.('.webclipper-inpage-comments-panel__reply-textarea') as
      | NodeListOf<HTMLTextAreaElement>
      | null;
    replyInputs?.forEach?.((node) => {
      try {
        node.disabled = false;
      } catch (_e) {
        // ignore
      }
    });

    const sendButtons = shadow.querySelectorAll?.('.webclipper-inpage-comments-panel__send') as
      | NodeListOf<HTMLButtonElement>
      | null;
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

  composerTextarea.addEventListener('input', () => refreshButtons());
  composerTextarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    composerSend.click();
  });

  composerSend.addEventListener('click', async () => {
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
    } finally {
      state.busy = false;
      refreshButtons();
    }
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
      const normalized = (Array.isArray(items) ? items : []).filter((x) => x && Number.isFinite(Number((x as any)?.id)));
      if (!normalized.length) {
        threads.appendChild(empty);
        refreshButtons();
        return;
      }

      const roots = normalized.filter((it) => !it.parentId);
      const repliesByRoot = new Map<number, ThreadedCommentItem[]>();
      for (const it of normalized) {
        if (!it.parentId) continue;
        const rootId = Number(it.parentId);
        const list = repliesByRoot.get(rootId) || [];
        list.push(it);
        repliesByRoot.set(rootId, list);
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
        del.setAttribute('aria-label', 'Delete');
        del.textContent = '×';
        del.addEventListener('click', async () => {
          if (state.busy) return;
          const handler = state.handlers.onDelete;
          if (typeof handler !== 'function') return;
          try {
            state.busy = true;
            refreshButtons();
            await handler(Number(root?.id));
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
            replyDel.setAttribute('aria-label', 'Delete');
            replyDel.textContent = '×';
            replyDel.addEventListener('click', async () => {
              if (state.busy) return;
              const handler = state.handlers.onDelete;
              if (typeof handler !== 'function') return;
              try {
                state.busy = true;
                refreshButtons();
                await handler(Number(reply?.id));
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

        replyTextarea.addEventListener('input', () => refreshButtons());
        replyTextarea.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          if (!(e.metaKey || e.ctrlKey)) return;
          e.preventDefault();
          replySend.click();
        });

        replySend.addEventListener('click', async () => {
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
          } finally {
            state.busy = false;
            refreshButtons();
          }
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
    shadow.addEventListener('keydown', stopShortcutKeyPropagation, true);
    shadow.addEventListener('keypress', stopShortcutKeyPropagation, true);
    shadow.addEventListener('keyup', stopShortcutKeyPropagation, true);
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
      themeObserver?.disconnect?.();
    } catch (_e) {
      // ignore
    }
    themeObserver = null;
    try {
      shadow.removeEventListener('keydown', stopShortcutKeyPropagation, true);
      shadow.removeEventListener('keypress', stopShortcutKeyPropagation, true);
      shadow.removeEventListener('keyup', stopShortcutKeyPropagation, true);
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
